-- 0022: confirm a waitlist address before it counts as a list
--
-- `identity.waitlist_signups` has held addresses since 0011, captured by one
-- click on the landing page and never confirmed by anybody. Nothing has ever
-- been sent to them, so that has cost nothing — but the first message to that
-- list would be sent to addresses that never proved they wanted it, which is
-- how a sending domain gets burned. This platform now has exactly one sending
-- domain, and account mail — verification, password reset — depends on it. A
-- marketing send that lands in spam takes the verification email with it.
--
-- So: an address joins the list unconfirmed, is emailed once asking it to
-- confirm, and becomes part of the list only when somebody clicks. The token
-- is stored as a hash, single-use and expiring, like every other mailed link
-- in this schema.
--
-- Additive. The columns are nullable and nothing reads them yet except the
-- confirmation flow itself.
alter table identity.waitlist_signups
  add column if not exists confirmed_at        timestamptz,
  add column if not exists confirm_token_hash  text,
  add column if not exists confirm_expires_at  timestamptz;

comment on column identity.waitlist_signups.confirmed_at is
  'When the address proved it wanted to be here. Null means unconfirmed: the '
  'row exists, and nothing may be sent to it.';

-- Only a hash, like identity.security_tokens and identity.refresh_tokens.
-- Reading this table does not let anybody confirm somebody else''s address.
--
-- Not in security_tokens with the other mailed links, deliberately: that table
-- is keyed to identity.users by a foreign key, and a person on the waitlist
-- has no account. Relaxing that key so a marketing confirmation could live
-- beside a password reset would weaken the stronger table to accommodate the
-- weaker case.
create unique index if not exists waitlist_confirm_token_uidx
  on identity.waitlist_signups (confirm_token_hash)
  where confirm_token_hash is not null;

-- The only query a send would run: who has actually opted in.
create index if not exists waitlist_confirmed_idx
  on identity.waitlist_signups (confirmed_at)
  where confirmed_at is not null;

-- The decision about the addresses already here:
--
-- **They stay unconfirmed.** No backfill, no audited exception.
--
-- The opposite call was made in 0021 for user accounts, and the difference is
-- what the two states cost. Leaving an existing account unverified locks a
-- real person out of their own health record for something they were never
-- told was coming; leaving a waitlist address unconfirmed costs that person
-- nothing, because nothing has ever been sent to them and nothing is being
-- taken away. Marking them confirmed would be asserting a consent that
-- demonstrably never happened, in the one table whose whole purpose is to
-- record that consent.
--
-- The practical consequence, and it should be written down rather than
-- discovered: whatever eventually sends to this list must filter on
-- `confirmed_at is not null`, and the addresses collected before today will
-- not receive it. They can be asked to confirm by any means outside this
-- system, or simply left alone.
