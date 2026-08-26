-- 0011: waitlist signups from the public landing page

create table if not exists identity.waitlist_signups (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  source      text not null default 'landing',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness, matching identity.users.
create unique index if not exists waitlist_signups_email_lower_uidx
  on identity.waitlist_signups (lower(email));
