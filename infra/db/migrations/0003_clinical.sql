-- 0003: clinical — conditions, medication records, lab results

create table if not exists clinical.conditions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references identity.users(id) on delete cascade,
  code_system  text,
  code         text,
  name         text not null,
  status       text not null,
  recorded_at  timestamptz,
  source       text not null,
  created_at   timestamptz not null default now(),
  constraint conditions_status_chk check (status in ('active','remission','resolved','unknown'))
);
create index if not exists conditions_user_idx on clinical.conditions (user_id, recorded_at desc);

create table if not exists clinical.medication_records (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references identity.users(id) on delete cascade,
  medication_name  text not null,
  dose_text        text,
  route            text,
  frequency_text   text,
  started_on       date,
  ended_on         date,
  status           text not null,
  source           text not null,
  created_at       timestamptz not null default now(),
  constraint medication_status_chk check (status in ('active','stopped','paused','unknown')),
  constraint medication_dates_chk  check (ended_on is null or started_on is null or ended_on >= started_on)
);
create index if not exists medication_records_user_idx
  on clinical.medication_records (user_id, started_on desc);

create table if not exists clinical.lab_results (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references identity.users(id) on delete cascade,
  test_name        text not null,
  code_system      text,
  code             text,
  value_numeric    numeric,
  value_text       text,
  unit             text,
  reference_range  text,
  collected_at     timestamptz not null,
  source           text not null,
  created_at       timestamptz not null default now(),
  constraint lab_results_value_chk check (value_numeric is not null or value_text is not null)
);
create index if not exists lab_results_user_test_idx
  on clinical.lab_results (user_id, test_name, collected_at desc);
