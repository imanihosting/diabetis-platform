-- 0004: metabolic — the timeline primitive + TimescaleDB hypertables

create table if not exists metabolic.events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references identity.users(id) on delete cascade,
  occurred_at  timestamptz not null,
  event_type   text not null,
  source       text not null,
  -- Confidence travels with every inferred row. 1.0 = directly observed.
  confidence   numeric not null default 1.0,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint events_confidence_chk check (confidence >= 0 and confidence <= 1)
);

create index if not exists metabolic_events_user_time_idx
  on metabolic.events (user_id, occurred_at desc);
create index if not exists metabolic_events_type_idx
  on metabolic.events (event_type);
create index if not exists metabolic_events_payload_idx
  on metabolic.events using gin (payload);

-- Dense time-series. Hypertables, not plain tables.
create table if not exists metabolic.glucose_samples (
  user_id        uuid not null references identity.users(id) on delete cascade,
  measured_at    timestamptz not null,
  glucose_value  numeric not null,
  unit           text not null,
  trend          text,
  source         text not null,
  device_id      uuid,
  quality        text,
  inserted_at    timestamptz not null default now(),
  primary key (user_id, measured_at, source),
  constraint glucose_unit_chk  check (unit in ('mmol/L','mg/dL')),
  constraint glucose_value_chk check (glucose_value > 0 and glucose_value < 100)
);

create table if not exists metabolic.activity_samples (
  user_id        uuid not null references identity.users(id) on delete cascade,
  measured_at    timestamptz not null,
  steps          integer,
  active_energy  numeric,
  heart_rate     numeric,
  source         text not null,
  inserted_at    timestamptz not null default now(),
  primary key (user_id, measured_at, source)
);

create table if not exists metabolic.sleep_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references identity.users(id) on delete cascade,
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  sleep_score  numeric,
  source       text not null,
  payload      jsonb not null default '{}'::jsonb,
  inserted_at  timestamptz not null default now(),
  constraint sleep_range_chk check (ended_at > started_at)
);
create index if not exists sleep_sessions_user_idx
  on metabolic.sleep_sessions (user_id, started_at desc);

-- create_hypertable is not idempotent across all versions; guard it.
select create_hypertable('metabolic.glucose_samples',  'measured_at', if_not_exists => true);
select create_hypertable('metabolic.activity_samples', 'measured_at', if_not_exists => true);
