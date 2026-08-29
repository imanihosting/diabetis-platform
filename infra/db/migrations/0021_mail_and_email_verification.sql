-- 0021: outbound mail, email verification, and single-use security tokens
--
-- Three things arrive together because none of them is useful alone: a queue
-- with nothing to send, a token nobody can be told about, or a verified flag
-- no email ever sets.
--
-- Additive throughout. Nothing here changes an existing column's meaning, and
-- the one backfill at the bottom is explicit about what it decided and leaves
-- a record of having decided it.

create schema if not exists notify;

-- ---------------------------------------------------------------------------
-- The outbox
-- ---------------------------------------------------------------------------
--
-- Mail is queued in the same transaction as the thing that caused it, and sent
-- afterwards by a worker. That ordering is the whole point: a signup that
-- rolls back must not have emailed anybody, and Microsoft Graph being slow or
-- throttled must not decide whether an account gets created.
--
-- What is deliberately NOT here: the rendered body. This platform's emails are
-- written to carry no glucose value, lab result or diagnosis, but a table that
-- accepts bodies is a table someone will later put one in, and rows here
-- outlive the decision that made them safe. The template name and a small,
-- reviewed metadata object say enough to debug a delivery without storing
-- anything a breach would make worse.
create table if not exists notify.mail_outbox (
  id                   uuid primary key default gen_random_uuid(),
  -- Null for mail to somebody who has no account: a password reset requested
  -- for an unknown address never gets this far, but a future operational
  -- notice might.
  user_id              uuid references identity.users(id) on delete set null,
  recipient_email      text not null,
  -- Which template rendered it, e.g. `email_verification.v1`. Versioned, so a
  -- template rewrite is visible in the history rather than silently rewriting
  -- what past rows claim to have been.
  template             text not null,
  subject              text not null,
  status               text not null default 'queued',
  provider             text not null default 'microsoft_graph',
  -- Graph's sendMail returns 202 with an empty body and no message id, so this
  -- is usually null. Kept because a provider that does return one should not
  -- need a migration, and because `sent` here means "accepted by the
  -- provider", never "delivered".
  provider_message_id  text,
  attempt_count        integer not null default 0,
  last_error           text,
  -- What stops one event producing two emails. Unique, so the guard is the
  -- database's rather than a service remembering to check.
  dedupe_key           text,
  -- When the worker may next pick this row up. Backoff after a transient
  -- failure, and Retry-After when Graph names one.
  next_attempt_at      timestamptz not null default now(),
  -- Safe, retained context: which flow caused this, which device class a
  -- sign-in notice describes. Read by the runbook and by support. Never a
  -- health field, and never a secret.
  metadata             jsonb not null default '{}'::jsonb,
  -- The variables the template needs, held only until the message is dealt
  -- with, then erased.
  --
  -- This is the one place a live token sits in the database in usable form,
  -- and it is worth being plain about why. Queue-then-send means the worker
  -- has to be able to render a message the request that caused it is no longer
  -- around for, and a verification link cannot be re-derived: the secret half
  -- exists once, at issue. The alternatives are worse — storing the rendered
  -- body keeps the same secret and adds the prose around it; sending inline
  -- puts Microsoft Graph's availability in the path of creating an account.
  --
  -- So: bounded rather than avoided. It is erased the moment the row reaches
  -- `sent`, `failed` or `skipped`, so it lives for one worker pass in the
  -- normal case; it never outlives the token's own expiry, which is an hour
  -- for a reset; and what it protects is a single-use token whose other half
  -- is stored as a hash, so this table alone still cannot be replayed after
  -- the message goes out.
  payload              jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  sent_at              timestamptz,
  constraint mail_outbox_status_chk
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped'))
);

create unique index if not exists mail_outbox_dedupe_uidx
  on notify.mail_outbox (dedupe_key) where dedupe_key is not null;

-- The worker's only query: the oldest row that is due.
create index if not exists mail_outbox_due_idx
  on notify.mail_outbox (next_attempt_at)
  where status in ('queued', 'sending');

-- Answers "how much has this address been sent lately", which is the
-- per-recipient send limit, and "what failed", which is the runbook.
create index if not exists mail_outbox_recipient_idx
  on notify.mail_outbox (lower(recipient_email), created_at desc);
create index if not exists mail_outbox_status_idx
  on notify.mail_outbox (status, created_at desc);

drop trigger if exists mail_outbox_set_updated_at on notify.mail_outbox;
create trigger mail_outbox_set_updated_at before update on notify.mail_outbox
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Single-use tokens
-- ---------------------------------------------------------------------------
--
-- One table for verification and password reset. They are the same object with
-- different consequences — a random secret, stored as a hash, usable once,
-- expiring — and splitting them would mean two places to get the expiry check
-- wrong.
--
-- Only the hash is stored, like identity.refresh_tokens: someone reading this
-- table cannot mint a working link from it.
create table if not exists identity.security_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references identity.users(id) on delete cascade,
  purpose     text not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint security_tokens_purpose_chk
    check (purpose in ('email_verification', 'password_reset'))
);

-- Supports "invalidate this user's outstanding tokens of this kind", which
-- every issue and every completion does.
create index if not exists security_tokens_user_purpose_idx
  on identity.security_tokens (user_id, purpose) where used_at is null;

-- ---------------------------------------------------------------------------
-- Devices seen signing in
-- ---------------------------------------------------------------------------
--
-- Only a hash of the fingerprint is kept. The raw user agent is a fairly
-- effective tracking identifier, and this table exists to answer one question
-- — "have we seen this before?" — which a hash answers just as well.
--
-- `device_class` is the coarse description the email is allowed to quote:
-- "Chrome on macOS", never the full string.
create table if not exists identity.sign_in_devices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references identity.users(id) on delete cascade,
  fingerprint_hash  text not null,
  device_class      text,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  unique (user_id, fingerprint_hash)
);

-- ---------------------------------------------------------------------------
-- Verification state, and what to do about the accounts that predate it
-- ---------------------------------------------------------------------------
alter table identity.users
  add column if not exists email_verified_at timestamptz;

comment on column identity.users.email_verified_at is
  'When the address was proven to belong to the account holder. Null means '
  'unverified: signed-in product routes are refused and no welcome mail is '
  'sent until it is set.';

-- The decision, made here rather than left to whoever runs this:
--
-- **Accounts that existed before this migration are marked verified.**
--
-- The alternative — null for everyone, re-verify on next sign-in — locks every
-- existing account, including the demo and test accounts the platform is
-- currently shown with, out of the product at the moment the migration lands,
-- and does it silently, since nobody has been told a verification email is
-- coming. That is a worse failure than the one it prevents.
--
-- What it costs: these addresses were never confirmed, so a typo'd signup from
-- before today keeps its account. That is exactly the state the platform is
-- already in; this migration does not make it worse, it stops it growing. Any
-- such account can be reset by setting the column back to null for that row,
-- which puts the person through the same flow a new signup gets.
--
-- The timestamp is `now()` and not the account's creation date, because
-- backdating it would put a verification that never happened at a moment it
-- provably did not happen at.
--
-- The update and the record of it are one statement, so the trail names
-- exactly the rows that changed rather than every row that happens to be
-- verified by the time it runs.
with backfilled as (
  update identity.users
     set email_verified_at = now()
   where email_verified_at is null
  returning id
)
insert into audit.events
  (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
-- `actor_user_id` is null because no person did this.
select null, b.id, 'identity.email_verified_backfill', 'user', b.id,
       jsonb_build_object('migration', '0021',
                          'reason', 'account predates email verification')
  from backfilled b;

create index if not exists users_unverified_idx
  on identity.users (created_at) where email_verified_at is null;
