-- 0008: audit — access trail and consent records

create table if not exists audit.events (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid references identity.users(id) on delete set null,
  subject_user_id uuid references identity.users(id) on delete set null,
  action          text not null,
  resource_type   text not null,
  resource_id     uuid,
  metadata        jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now()
);
create index if not exists audit_events_subject_idx on audit.events (subject_user_id, occurred_at desc);
create index if not exists audit_events_actor_idx   on audit.events (actor_user_id, occurred_at desc);
create index if not exists audit_events_action_idx  on audit.events (action, occurred_at desc);

-- The audit trail is append-only.
create or replace function audit.guard_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit.events is append-only';
end;
$$;

drop trigger if exists audit_events_append_only on audit.events;
create trigger audit_events_append_only
  before update or delete on audit.events
  for each row execute function audit.guard_append_only();

create table if not exists audit.consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references identity.users(id) on delete cascade,
  consent_type text not null,
  granted_to   text,
  status       text not null,
  granted_at   timestamptz,
  revoked_at   timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  constraint consents_status_chk check (status in ('granted','revoked','pending','expired'))
);
create index if not exists consents_user_idx on audit.consents (user_id, consent_type);
