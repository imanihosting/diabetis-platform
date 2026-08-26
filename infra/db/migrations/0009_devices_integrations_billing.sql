-- 0009: devices, integrations, billing

create table if not exists devices.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references identity.users(id) on delete cascade,
  device_type   text not null,
  manufacturer  text,
  model         text,
  external_id   text,
  status        text not null default 'active',
  linked_at     timestamptz not null default now(),
  metadata      jsonb not null default '{}'::jsonb,
  constraint devices_type_chk   check (device_type in ('cgm','glucose_meter','wearable','scale','bp_monitor','phone','other')),
  constraint devices_status_chk check (status in ('active','inactive','revoked'))
);
create index if not exists devices_user_idx on devices.devices (user_id);

-- Provenance for every bulk import (CSV, device export, FHIR pull).
create table if not exists integrations.import_jobs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references identity.users(id) on delete cascade,
  source            text not null,
  kind              text not null,
  -- Original uploaded file, kept in object storage for replay and audit.
  object_key        text,
  status            text not null default 'pending',
  rows_total        integer,
  rows_imported     integer,
  rows_rejected     integer,
  error_summary     jsonb,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint import_jobs_status_chk check (status in ('pending','processing','completed','failed'))
);
create index if not exists import_jobs_user_idx on integrations.import_jobs (user_id, created_at desc);

create table if not exists billing.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references identity.users(id) on delete cascade,
  plan               text not null,
  status             text not null,
  external_ref       text,
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint subscriptions_status_chk check (status in ('trialing','active','past_due','canceled'))
);
create index if not exists subscriptions_user_idx on billing.subscriptions (user_id);

drop trigger if exists subscriptions_set_updated_at on billing.subscriptions;
create trigger subscriptions_set_updated_at before update on billing.subscriptions
  for each row execute function public.set_updated_at();
