-- 0007: ai — model accountability, immutable predictions, semantic memory
--
-- EMBEDDING DIMENSION: 1536 is a placeholder matching common embedding models.
-- Fix this to the real model dimension before the first production migration
-- (see docs/data-model.md). Changing it later requires a table rewrite.

create table if not exists ai.model_versions (
  id                   uuid primary key default gen_random_uuid(),
  model_name           text not null,
  version              text not null,
  training_data_window text,
  parameters           jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  unique (model_name, version)
);

create table if not exists ai.predictions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references identity.users(id) on delete cascade,
  model_version_id uuid not null references ai.model_versions(id),
  prediction_type  text not null,
  made_at          timestamptz not null default now(),
  target_at        timestamptz,
  -- Enough input context to replay the model decision later.
  input_snapshot   jsonb not null,
  prediction       jsonb not null,
  confidence       numeric,
  status           text not null default 'pending',
  constraint predictions_status_chk     check (status in ('pending','matched','expired','unmatchable')),
  constraint predictions_confidence_chk check (confidence is null or (confidence between 0 and 1))
);
create index if not exists predictions_user_idx   on ai.predictions (user_id, made_at desc);
create index if not exists predictions_target_idx on ai.predictions (target_at) where status = 'pending';

-- Hard rule from the roadmap: predictions are immutable once written.
-- Outcomes are attached in a separate table; only `status` may be advanced.
create or replace function ai.guard_prediction_immutability()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ai.predictions rows are immutable and cannot be deleted';
  end if;

  -- Everything except `status` is frozen at write time.
  if (new.id, new.user_id, new.model_version_id, new.prediction_type, new.made_at,
      new.target_at, new.input_snapshot, new.prediction, new.confidence)
     is distinct from
     (old.id, old.user_id, old.model_version_id, old.prediction_type, old.made_at,
      old.target_at, old.input_snapshot, old.prediction, old.confidence)
  then
    raise exception 'ai.predictions is immutable; only status may change';
  end if;

  return new;
end;
$$;

drop trigger if exists predictions_immutable on ai.predictions;
create trigger predictions_immutable
  before update or delete on ai.predictions
  for each row execute function ai.guard_prediction_immutability();

create table if not exists ai.prediction_outcomes (
  id            uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references ai.predictions(id) on delete restrict,
  observed_at   timestamptz not null,
  outcome       jsonb not null,
  error_summary jsonb,
  created_at    timestamptz not null default now(),
  unique (prediction_id)
);

-- Semantic memory. Retrieval only — never a store for core medical measurements.
create table if not exists ai.observations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references identity.users(id) on delete cascade,
  observation_type text not null,
  statement        text not null,
  evidence_refs    jsonb not null default '[]'::jsonb,
  confidence       numeric,
  embedding        vector(1536),
  created_at       timestamptz not null default now(),
  constraint observations_confidence_chk check (confidence is null or (confidence between 0 and 1))
);
create index if not exists observations_user_idx on ai.observations (user_id, created_at desc);

-- HNSW index for cosine similarity retrieval.
create index if not exists observations_embedding_idx
  on ai.observations using hnsw (embedding vector_cosine_ops);
