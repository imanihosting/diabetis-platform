-- 0006: experiments — hypotheses, experiments, results

create table if not exists experiments.hypotheses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references identity.users(id) on delete cascade,
  hypothesis_type     text not null,
  statement           text not null,
  prior_probability   numeric,
  current_probability numeric,
  status              text not null default 'open',
  evidence_summary    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint hypotheses_status_chk check (status in ('open','testing','supported','refuted','abandoned')),
  constraint hypotheses_prior_chk  check (prior_probability   is null or (prior_probability   between 0 and 1)),
  constraint hypotheses_curr_chk   check (current_probability is null or (current_probability between 0 and 1))
);
create index if not exists hypotheses_user_idx on experiments.hypotheses (user_id, created_at desc);

drop trigger if exists hypotheses_set_updated_at on experiments.hypotheses;
create trigger hypotheses_set_updated_at before update on experiments.hypotheses
  for each row execute function public.set_updated_at();

create table if not exists experiments.experiments (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references identity.users(id) on delete cascade,
  hypothesis_id             uuid references experiments.hypotheses(id) on delete set null,
  title                     text not null,
  question                  text not null,
  protocol                  jsonb not null,
  -- Safety gate. See docs/technical-architecture.md "Safety Boundaries".
  safety_status             text not null,
  clinician_review_required boolean not null default false,
  status                    text not null default 'draft',
  started_at                timestamptz,
  ended_at                  timestamptz,
  created_at                timestamptz not null default now(),
  constraint experiments_safety_chk
    check (safety_status in ('allowed','clinician_gated','blocked')),
  constraint experiments_status_chk
    check (status in ('draft','awaiting_review','active','completed','abandoned')),
  -- A clinician-gated experiment can never silently skip review.
  constraint experiments_gate_chk
    check (safety_status <> 'clinician_gated' or clinician_review_required = true),
  -- Blocked experiments must never run.
  constraint experiments_blocked_chk
    check (safety_status <> 'blocked' or status in ('draft','abandoned'))
);
create index if not exists experiments_user_idx on experiments.experiments (user_id, created_at desc);

create table if not exists experiments.results (
  id              uuid primary key default gen_random_uuid(),
  experiment_id   uuid not null references experiments.experiments(id) on delete cascade,
  result_summary  text not null,
  effect_estimate numeric,
  effect_unit     text,
  confidence      numeric,
  limitations     jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  constraint results_confidence_chk check (confidence is null or (confidence between 0 and 1))
);
create index if not exists results_experiment_idx on experiments.results (experiment_id);
