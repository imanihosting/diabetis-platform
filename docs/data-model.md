# Data Model

## Goal

The first database model should support the platform's real differentiator: personal metabolic evidence.

It must store more than readings. It must store context, hypotheses, experiments, predictions, outcomes, confidence, and clinician-ready summaries.

## Schemas

Enable the database extensions before creating the domain tables:

```sql
create extension if not exists timescaledb;
create extension if not exists vector;
create extension if not exists pgcrypto;
```

Use application-generated UUIDs or `gen_random_uuid()` defaults. If the PostgreSQL version supports timestamp-ordered UUIDs and the team standardizes on them, use that consistently across all tables.

```sql
create schema identity;
create schema clinical;
create schema metabolic;
create schema nutrition;
create schema experiments;
create schema ai;
create schema devices;
create schema integrations;
create schema audit;
```

## Identity

```sql
create table identity.users (
  id uuid primary key,
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table identity.organisations (
  id uuid primary key,
  name text not null,
  organisation_type text not null,
  created_at timestamptz not null default now()
);

create table identity.memberships (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  organisation_id uuid not null references identity.organisations(id),
  role text not null,
  created_at timestamptz not null default now(),
  unique (user_id, organisation_id)
);
```

## Clinical Data

```sql
create table clinical.conditions (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  code_system text,
  code text,
  name text not null,
  status text not null,
  recorded_at timestamptz,
  source text not null,
  created_at timestamptz not null default now()
);

create table clinical.medication_records (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  medication_name text not null,
  dose_text text,
  route text,
  frequency_text text,
  started_on date,
  ended_on date,
  status text not null,
  source text not null,
  created_at timestamptz not null default now()
);

create table clinical.lab_results (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  test_name text not null,
  code_system text,
  code text,
  value_numeric numeric,
  value_text text,
  unit text,
  reference_range text,
  collected_at timestamptz not null,
  source text not null,
  created_at timestamptz not null default now()
);
```

Key Type 2 diabetes labs to support early:

- HbA1c
- fasting glucose
- eGFR
- UACR
- LDL-C, HDL-C, triglycerides
- ALT and AST where relevant
- blood pressure readings
- weight and BMI

## Metabolic Timeline

The timeline is the central product primitive.

```sql
create table metabolic.events (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  occurred_at timestamptz not null,
  event_type text not null,
  source text not null,
  confidence numeric not null default 1.0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index metabolic_events_user_time_idx
  on metabolic.events (user_id, occurred_at desc);

create index metabolic_events_type_idx
  on metabolic.events (event_type);
```

Example event types:

- glucose_sample
- meal_started
- meal_ended
- medication_taken
- exercise_started
- exercise_ended
- sleep_started
- sleep_ended
- stress_reported
- symptom_reported
- lab_collected
- appointment

## Time-Series Measurements

Dense data should live in TimescaleDB hypertables.

```sql
create table metabolic.glucose_samples (
  user_id uuid not null references identity.users(id),
  measured_at timestamptz not null,
  glucose_value numeric not null,
  unit text not null,
  trend text,
  source text not null,
  device_id uuid,
  quality text,
  inserted_at timestamptz not null default now(),
  primary key (user_id, measured_at, source)
);

create table metabolic.activity_samples (
  user_id uuid not null references identity.users(id),
  measured_at timestamptz not null,
  steps integer,
  active_energy numeric,
  heart_rate numeric,
  source text not null,
  inserted_at timestamptz not null default now(),
  primary key (user_id, measured_at, source)
);

create table metabolic.sleep_sessions (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  sleep_score numeric,
  source text not null,
  payload jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now()
);
```

Timescale setup:

```sql
select create_hypertable('metabolic.glucose_samples', 'measured_at');
select create_hypertable('metabolic.activity_samples', 'measured_at');
```

## Nutrition

```sql
create table nutrition.meals (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  meal_type text,
  description text,
  photo_object_key text,
  source text not null,
  confidence numeric not null default 1.0,
  created_at timestamptz not null default now()
);

create table nutrition.meal_items (
  id uuid primary key,
  meal_id uuid not null references nutrition.meals(id),
  item_name text not null,
  estimated_carbs_g numeric,
  estimated_protein_g numeric,
  estimated_fat_g numeric,
  estimated_fiber_g numeric,
  portion_text text,
  confidence numeric not null default 0.5,
  created_at timestamptz not null default now()
);
```

## Experiments

Experiments are not reminders. They are evidence-generating workflows.

```sql
create table experiments.hypotheses (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  hypothesis_type text not null,
  statement text not null,
  prior_probability numeric,
  current_probability numeric,
  status text not null,
  evidence_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table experiments.experiments (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  hypothesis_id uuid references experiments.hypotheses(id),
  title text not null,
  question text not null,
  protocol jsonb not null,
  safety_status text not null,
  clinician_review_required boolean not null default false,
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table experiments.results (
  id uuid primary key,
  experiment_id uuid not null references experiments.experiments(id),
  result_summary text not null,
  effect_estimate numeric,
  effect_unit text,
  confidence numeric,
  limitations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
```

## AI Accountability

Every prediction should be immutable.

```sql
create table ai.model_versions (
  id uuid primary key,
  model_name text not null,
  version text not null,
  training_data_window text,
  parameters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (model_name, version)
);

create table ai.predictions (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  model_version_id uuid not null references ai.model_versions(id),
  prediction_type text not null,
  made_at timestamptz not null default now(),
  target_at timestamptz,
  input_snapshot jsonb not null,
  prediction jsonb not null,
  confidence numeric,
  status text not null default 'pending'
);

create table ai.prediction_outcomes (
  id uuid primary key,
  prediction_id uuid not null references ai.predictions(id),
  observed_at timestamptz not null,
  outcome jsonb not null,
  error_summary jsonb,
  created_at timestamptz not null default now(),
  unique (prediction_id)
);
```

## Semantic Memory

Use pgvector for semantic retrieval, not for core medical measurements.

```sql
create table ai.observations (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  observation_type text not null,
  statement text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  confidence numeric,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
```

The `1536` vector size is an implementation placeholder. Set it to the actual embedding model dimension before the first production migration.

Examples:

- "Post-dinner walking appears associated with lower peak glucose."
- "Late meals have repeatedly preceded longer recovery times."
- "Sleep data is too sparse to explain morning glucose changes."

## Audit

Health data needs a strong audit trail.

```sql
create table audit.events (
  id uuid primary key,
  actor_user_id uuid references identity.users(id),
  subject_user_id uuid references identity.users(id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table audit.consents (
  id uuid primary key,
  user_id uuid not null references identity.users(id),
  consent_type text not null,
  granted_to text,
  status text not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
```

## FHIR Mapping

| Platform object | FHIR-oriented resource |
|---|---|
| `identity.users` | Patient |
| `clinical.conditions` | Condition |
| `clinical.medication_records` | MedicationStatement / MedicationRequest |
| `clinical.lab_results` | Observation / DiagnosticReport |
| `metabolic.glucose_samples` | Observation |
| `nutrition.meals` | Observation or NutritionIntake-style internal mapping |
| `audit.consents` | Consent |
| Generated clinician brief | DocumentReference |

## Early Design Rules

- Keep raw data and derived insights separate.
- Never overwrite predictions after they are made.
- Attach source and confidence to inferred data.
- Store enough input context to replay model decisions.
- Treat medication changes as clinician-gated workflows.
- Make every user-facing insight traceable to evidence.
