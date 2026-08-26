-- 0002: identity — users, credentials, organisations, memberships

create table if not exists identity.users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  display_name   text,
  -- 'patient' | 'clinician' | 'admin' — the platform-level role.
  -- Organisation-scoped roles live in identity.memberships.
  primary_role   text not null default 'patient',
  status         text not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint users_primary_role_chk check (primary_role in ('patient','clinician','admin')),
  constraint users_status_chk       check (status in ('active','suspended','deleted'))
);

-- Case-insensitive uniqueness without requiring the citext extension.
create unique index if not exists users_email_lower_uidx
  on identity.users (lower(email));

drop trigger if exists users_set_updated_at on identity.users;
create trigger users_set_updated_at before update on identity.users
  for each row execute function public.set_updated_at();

-- Credentials are separated from the user record so that swapping to an
-- external OIDC provider later means dropping this table, not reshaping users.
create table if not exists identity.credentials (
  user_id        uuid primary key references identity.users(id) on delete cascade,
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists credentials_set_updated_at on identity.credentials;
create trigger credentials_set_updated_at before update on identity.credentials
  for each row execute function public.set_updated_at();

create table if not exists identity.refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references identity.users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists refresh_tokens_user_idx
  on identity.refresh_tokens (user_id) where revoked_at is null;

create table if not exists identity.organisations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  organisation_type  text not null,
  created_at         timestamptz not null default now(),
  constraint organisations_type_chk
    check (organisation_type in ('clinic','employer','research','platform'))
);

create table if not exists identity.memberships (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references identity.users(id) on delete cascade,
  organisation_id  uuid not null references identity.organisations(id) on delete cascade,
  role             text not null,
  created_at       timestamptz not null default now(),
  unique (user_id, organisation_id),
  constraint memberships_role_chk
    check (role in ('owner','admin','clinician','staff','member'))
);
