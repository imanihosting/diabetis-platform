# Technical Architecture

## Concept

The platform is a differentiated Type 2 diabetes system built around causal personal experimentation.

It should not behave like a generic tracker, food diary, glucose dashboard, or chatbot. The core loop is:

1. Collect trusted personal metabolic data.
2. Build a timeline of meals, glucose, movement, sleep, medication, labs, symptoms, and clinical events.
3. Detect patterns and uncertainties.
4. Generate competing hypotheses.
5. Propose safe experiments or observations.
6. Measure results against the original prediction.
7. Convert the evidence into user-facing explanations and clinician-facing summaries.

## System Map

```text
                         Type 2 Diabetes Platform

        Next.js Web App                         React Native App
  Patient, clinician, admin              Mobile logging, device links
              │                                      │
              └──────────────────┬───────────────────┘
                                 │
                          NestJS Core API
        Identity, permissions, consent, timeline, billing,
       integrations, experiment workflow, reports, audit logs
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
 PostgreSQL primary        Redis queues/cache       S3-compatible storage
 relational, JSONB,        jobs, locks,             imports, attachments,
 TimescaleDB, pgvector     notifications            generated packets
        │
        │
        ▼
 Python/FastAPI Metabolic Intelligence Service
 pattern engine, prediction engine, causal engine,
 hypothesis engine, experiment analyzer, explanation inputs
```

## Frontend

Use Next.js, React, and TypeScript for the first web product.

Primary views:

- Personal metabolic timeline
- Future Sandbox for simulating likely outcomes
- Living Trials for safe self-experiments
- Metabolic Fingerprint
- Diabetes Protection Ring
- Diabetes Passport
- Clinician Evidence Room

Frontend support libraries:

- TanStack Query for server state
- Zod for input validation and API contracts
- Tailwind CSS plus a restrained design system
- shadcn/ui as a component starting point, not the final product identity

The interface should feel like a serious health intelligence tool. Avoid generic dashboard cards as the primary design language. The main product surface should make uncertainty, evidence quality, and next actions visible.

## Backend

Use NestJS as the core application backend.

Primary backend domains:

- Identity and organisations
- Consent and permissions
- Health data ingestion
- Metabolic timeline
- Meals and nutrition
- Medication records
- Experiments and hypotheses
- Insight generation
- Clinician reports
- Audit logging
- Billing and subscriptions

NestJS should own application state and user workflows. It should not own scientific computation.

## Metabolic Intelligence Service

Use Python and FastAPI for the metabolic intelligence service.

This service owns:

- Pattern detection
- Prediction generation
- Causal analysis
- Hypothesis ranking
- Experiment design support
- Experiment result analysis
- Confidence scoring
- Model accountability

The language model must not invent clinical conclusions. The safe flow is:

```text
Raw data
  ↓
Quantitative model
  ↓
Structured finding with confidence and evidence
  ↓
LLM explanation
  ↓
Human-readable explanation
```

Example structured finding:

```json
{
  "finding_type": "post_meal_walk_effect",
  "effect_estimate": -1.3,
  "unit": "mmol/L peak glucose",
  "confidence": 0.82,
  "sample_count": 17,
  "limitations": [
    "Meals were similar but not identical",
    "Medication timing was inferred for 4 observations"
  ]
}
```

## Database

PostgreSQL is the system of record.

Recommended extensions:

- TimescaleDB for glucose and wearable time-series data
- pgvector for semantic observations and AI memory
- pgcrypto or native UUID support for identifiers

Keep the database split by domain schemas:

```text
identity
clinical
metabolic
nutrition
experiments
ai
devices
integrations
audit
billing
```

## FHIR-Oriented Health Data Integration

Use FHIR-shaped internal mappings even before full certified integrations exist.

Important FHIR resources:

- Patient
- Observation
- MedicationStatement
- MedicationRequest
- Condition
- DiagnosticReport
- DocumentReference
- CarePlan
- Goal
- AllergyIntolerance

The aim is not to expose every FHIR resource on day one. The aim is to avoid trapping health records in a custom shape that clinicians and integrations cannot use later.

## Safety Boundaries

The platform may help users understand patterns and prepare better discussions with clinicians. It must not autonomously adjust medication, diagnose complications, or give emergency advice.

Experiment categories:

- Allowed initially: meal timing, walking after meals, sleep observation, hydration logging, portion comparison, meal order, stress tagging.
- Clinician-gated: medication timing, medication dose, fasting protocols, major diet changes, exercise changes for high-risk users.
- Never app-only: acute hypoglycemia or hyperglycemia treatment, insulin dosing, emergency triage, medication discontinuation.

Every insight should carry:

- Evidence strength
- Confidence
- Limitations
- Whether clinician review is recommended
- What data would improve the answer

## First Production Architecture

Start with a modular monorepo:

```text
apps/
  web/
  mobile/
services/
  api/
  metabolic-engine/
packages/
  types/
  api-client/
  config/
  ui-tokens/
infra/
  docker/
  db/
docs/
```

Deployment can start with containers on a managed cloud platform. Kubernetes can wait until the operational need is real.

Minimum production services:

- Next.js web app
- NestJS API
- FastAPI metabolic engine
- PostgreSQL with TimescaleDB and pgvector
- Redis
- S3-compatible object storage
- Background worker process
- Observability stack using OpenTelemetry

