-- 0013: clinical — diabetes profile and safety flags
--
-- Phase A of docs/diabetes-wide-platform.md. Purely additive: nothing here
-- rewrites clinical.conditions, metabolic.glucose_samples, nutrition.meals or
-- experiments.*, and no existing behaviour depends on these tables yet.
--
-- Three deliberate departures from the shape sketched in that document, each
-- because the sketch would have created a problem this schema exists to avoid.
-- They are recorded next to the thing they affected.

create table if not exists clinical.diabetes_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references identity.users(id) on delete cascade,

  -- Diagnosis category. What a clinician would call it.
  diabetes_type     text not null,

  -- Operational context the software reasons about. Deliberately separate from
  -- the diagnosis: two people with the same diagnosis can need different
  -- safety postures, and a type alone cannot tell the product whether insulin
  -- is in the picture.
  care_mode         text not null,

  diagnosed_on      date,
  -- 'assumed' matters. Everyone registered before this migration signed up to a
  -- product that only offers Type 2, so they are backfilled as Type 2 — but
  -- nobody asked them, and a profile that cannot tell an answer from an
  -- assumption will eventually be trusted as though someone had.
  diagnosis_source  text not null default 'self_reported',

  clinician_supported boolean not null default false,
  payload           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (user_id),

  constraint diabetes_type_chk check (
    diabetes_type in (
      'type_1','type_2','gestational','prediabetes','other_specific','unknown'
    )
  ),
  constraint care_mode_chk check (
    care_mode in (
      'type_2_standard',
      'type_2_insulin_supported',
      'prediabetes',
      'gestational',
      'type_1_cgm_insulin',
      'other_specific',
      'unknown'
    )
  ),
  constraint diagnosis_source_chk check (
    diagnosis_source in ('self_reported','clinician','imported','assumed')
  )
);

create index if not exists diabetes_profiles_care_mode_idx
  on clinical.diabetes_profiles (care_mode);

drop trigger if exists diabetes_profiles_set_updated_at on clinical.diabetes_profiles;
create trigger diabetes_profiles_set_updated_at
  before update on clinical.diabetes_profiles
  for each row execute function public.set_updated_at();

-- NO safety_tier COLUMN, and that is the point.
--
-- The tier is a function of the care mode and the flags currently active. Given
-- a column, the two drift: a pregnancy flag gets written, the tier still reads
-- 'standard', and the safety service asks the stale copy. This platform's
-- stated posture is that the database enforces the safety rules, and a stored
-- derived value is a rule that can be wrong while looking authoritative.
-- Derivation lives in `deriveSafetyTier` in @wellovue/types, tested there, and
-- is computed from the rows below on every read.

-- NO target_low / target_high COLUMNS YET.
--
-- Superseded in part: the four separate declarations of 3.9 and 10.0 (the
-- backend summary, two frontend components, and the Python engine) are now one
-- constant in packages/types/src/glucose.ts, checked across the language
-- boundary by backend/test/target-range.spec.ts.
--
-- The columns still do not exist, and that part stands. Nothing reads a
-- per-user target yet, and a column that looks authoritative while nothing
-- reads it is worse than no column: the next person sets it, sees no change,
-- and cannot tell whether the feature is broken or absent. Add them as a
-- nullable override when something is ready to honour them. Adding a column
-- later is an ALTER; removing one that has been lying to people is not.

-- Product safety context, not diagnoses.
--
-- Append-only, like audit.events and ai.predictions. A safety flag is a claim
-- about risk at a moment in time, and the history of when the product believed
-- someone was pregnant, or using insulin, is exactly the sort of thing that
-- must not be quietly rewritten later. A flag is therefore resolved by
-- inserting a row saying so, not by updating the row that raised it, and the
-- current state of a flag is its most recent row.
--
-- This is why there is no `resolved_at` and no unique constraint on
-- (user_id, flag): both belong to a mutable design, and this is not one.
create table if not exists clinical.diabetes_safety_flags (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references identity.users(id) on delete cascade,
  flag         text not null,
  status       text not null,
  source       text not null,
  recorded_at  timestamptz not null default now(),
  metadata     jsonb not null default '{}'::jsonb,

  constraint safety_flag_status_chk check (status in ('active','inactive','unknown')),
  constraint safety_flag_source_chk check (
    source in ('self_reported','clinician','imported','derived')
  ),
  constraint safety_flag_name_chk check (
    flag in (
      'insulin_therapy',
      'pump_or_automated_insulin_delivery',
      'pregnancy',
      'hypoglycemia_unawareness',
      'history_of_severe_hypoglycemia',
      'kidney_disease',
      'cardiovascular_risk',
      'paediatric_user',
      'clinician_managed_protocol'
    )
  )
);

create index if not exists diabetes_safety_flags_user_idx
  on clinical.diabetes_safety_flags (user_id, flag, recorded_at desc);

create or replace function clinical.guard_safety_flag_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'clinical.diabetes_safety_flags is append-only; resolve a flag by inserting a row with status = ''inactive''';
end;
$$;

drop trigger if exists diabetes_safety_flags_append_only on clinical.diabetes_safety_flags;
create trigger diabetes_safety_flags_append_only
  before update or delete on clinical.diabetes_safety_flags
  for each row execute function clinical.guard_safety_flag_append_only();

-- Backfill.
--
-- Every account that exists today was created against a product whose landing
-- page, onboarding and pattern engine offer Type 2 and nothing else. Leaving
-- them 'unknown' would be conservative in name and wrong in effect: it would
-- take the evidence screen away from people whose data has not changed and
-- whose findings were computed correctly yesterday. They are recorded as Type 2
-- with the source set to 'assumed', so the assumption stays visible and
-- onboarding can replace it with an answer.
insert into clinical.diabetes_profiles (user_id, diabetes_type, care_mode, diagnosis_source)
select u.id, 'type_2', 'type_2_standard', 'assumed'
  from identity.users u
 where not exists (
   select 1 from clinical.diabetes_profiles p where p.user_id = u.id
 );
