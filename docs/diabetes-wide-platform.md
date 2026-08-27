# Diabetes-Wide Platform Expansion

## Purpose

Wellovue was intentionally built as a Type 2 diabetes platform first. That is
still the right wedge: the current product has a clear user, a clear evidence
loop, and a clear reason to exist beyond tracking.

To become a diabetes-wide platform, do not replace that wedge with a generic
"diabetes tracker." The correct move is to keep the same product primitive:

> Turn everyday diabetes data into personal, testable metabolic evidence.

Then make the clinical profile, safety rules, and intelligence modules aware of
the kind of diabetes, the treatment context, pregnancy status, devices, and
clinician involvement.

## Non-Goals

Do not make these changes as part of the expansion:

- Do not dilute the landing page into "for everyone with diabetes" before the
  product can safely serve everyone.
- Do not add a `diabetesType` dropdown and call the platform complete.
- Do not reuse Type 2 pattern logic for Type 1 insulin, pregnancy, or acute
  glucose situations.
- Do not provide insulin dosing, acute hypo/hyperglycemia treatment, emergency
  triage, or medication stopping advice.
- Do not let a language model create clinical conclusions.
- Do not remove the current Type 2 evidence path while the wider model is being
  built.

## Current Foundation To Preserve

Keep these decisions intact:

- PostgreSQL remains the system of record.
- TimescaleDB remains the store for dense glucose and activity series.
- pgvector is for semantic observations and retrieval, not raw measurements.
- NestJS owns identity, permissions, ingestion, evidence workflow, audit, and
  reports.
- Python/FastAPI owns quantitative pattern detection and future scientific
  computation.
- Evidence is always structured before it is explained in prose.
- Safety rules fail closed: unknown templates are gated, never allowed by
  default.
- Existing Type 2 pattern detection continues to power `/evidence`.

## Expansion Principle

The platform should be diabetes-wide in architecture before it is diabetes-wide
in marketing.

That means the database and API can represent Type 1, Type 2, gestational,
prediabetes, and other specific forms of diabetes, while the released product
can still say clearly:

> Wellovue currently supports Type 2 evidence workflows. Other care modes are
> being built behind stricter safety gates.

This avoids two bad outcomes: rebuilding the data model later, and implying
support for a higher-risk workflow before the product is ready.

## Target Diabetes Modes

Use "care mode" rather than only "type." Diabetes type is a diagnosis category.
Care mode is the operational context the product needs to make safe software
decisions.

| Care mode | Primary need | Intelligence emphasis | Release posture |
|---|---|---|---|
| `type_2_standard` | Understand personal glucose response, meals, movement, sleep, medication context | Associations, safe experiments, prediction accountability | Current default |
| `type_2_insulin_supported` | Type 2 with insulin in the medication picture | Stronger safety boundaries around insulin and hypo risk | Add after profile and safety gates |
| `prediabetes` | Track risk and response to behavior changes without over-medicalizing | Lab trends, activity, weight, meal timing, prevention evidence | Good second audience |
| `gestational` | Pregnancy-specific monitoring and clinician reporting | Fasting/post-meal patterns, pregnancy week context, clinician packet | Build only with clinical review |
| `type_1_cgm_insulin` | Insulin, carb, activity, and CGM context with high hypo/DKA risk | Device-aware analysis, hypo risk context, pump/CGM provenance | Later, regulated-risk posture |
| `other_specific` | Monogenic, pancreatic, medication-induced, or clinician-classified diabetes | Record portability, less automated interpretation | Clinician-supported only |
| `unknown` | User has not supplied enough context | Minimal descriptive summaries only | Default when uncertain |

## Data Model Changes

Make the next migration additive. Do not rewrite existing `clinical.conditions`,
`metabolic.glucose_samples`, `nutrition.meals`, or `experiments.*` tables.

Add a profile layer:

```sql
create table if not exists clinical.diabetes_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  diabetes_type text not null,
  care_mode text not null,
  diagnosed_on date,
  diagnosis_source text not null default 'self_reported',
  glucose_unit text not null default 'mmol/L',
  target_low numeric,
  target_high numeric,
  safety_tier text not null default 'standard',
  clinician_supported boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  constraint diabetes_type_chk check (
    diabetes_type in (
      'type_1',
      'type_2',
      'gestational',
      'prediabetes',
      'other_specific',
      'unknown'
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
  constraint glucose_unit_chk check (glucose_unit in ('mmol/L', 'mg/dL')),
  constraint target_range_chk check (
    target_low is null
    or target_high is null
    or target_high > target_low
  ),
  constraint safety_tier_chk check (
    safety_tier in ('standard', 'clinician_supported', 'high_risk', 'pregnancy')
  )
);
```

Add explicit safety flags. Do not rely only on medication names or user copy,
because names vary and imports can be incomplete.

```sql
create table if not exists clinical.diabetes_safety_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  flag text not null,
  status text not null,
  source text not null,
  recorded_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint safety_flag_status_chk check (
    status in ('active', 'inactive', 'unknown')
  )
);

create index if not exists diabetes_safety_flags_user_idx
  on clinical.diabetes_safety_flags (user_id, flag, recorded_at desc);
```

Initial flags:

- `insulin_therapy`
- `pump_or_automated_insulin_delivery`
- `pregnancy`
- `hypoglycemia_unawareness`
- `history_of_severe_hypoglycemia`
- `kidney_disease`
- `cardiovascular_risk`
- `paediatric_user`
- `clinician_managed_protocol`

These are not diagnoses by themselves. They are product safety context.

## Shared Type Changes

Add shared schemas in `packages/types` before wiring UI or backend behavior:

- `diabetesTypeSchema`
- `careModeSchema`
- `safetyTierSchema`
- `diabetesProfileSchema`
- `diabetesSafetyFlagSchema`
- `careModeCapabilitiesSchema`

Keep the current evidence contract backward-compatible:

```ts
type StructuredFinding = {
  findingType: string;
  summary: string;
  effectEstimate: number | null;
  effectUnit: string | null;
  confidence: number;
  sampleCount: number;
  limitations: string[];
  clinicianReviewRecommended: boolean;
  wouldImproveWith: string[];
};
```

If care-mode context is needed, add optional fields rather than changing existing
required fields:

```ts
careMode?: CareMode;
safetyTier?: SafetyTier;
notFor?: CareMode[];
requiresClinicianReview?: boolean;
```

That lets the current `/evidence` page continue to render existing findings
while newer detectors carry richer metadata.

## Backend Changes

Add a `DiabetesProfileModule` in NestJS with these responsibilities:

- Store and return the signed-in user's diabetes profile.
- Store safety flags with source and audit events.
- Derive a conservative care mode when the profile is incomplete.
- Expose capabilities to the frontend, such as which evidence types are enabled.
- Block unsupported workflows before they reach the metabolic engine.

Suggested endpoints:

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /api/diabetes-profile` | Return profile, flags, care mode, and capabilities | Required |
| `PUT /api/diabetes-profile` | Update profile fields from onboarding/settings | Required |
| `POST /api/diabetes-profile/flags` | Add or update a safety flag | Required |
| `GET /api/diabetes-profile/capabilities` | Return enabled evidence, experiment, and report features | Required |

Every write must create an audit event. Treat profile changes as health-data
changes, not account preferences.

## Evidence Routing

Keep `GET /api/evidence` as the public product route inside the signed-in app.
Change what happens behind it:

```text
GET /api/evidence
  |
  v
NestJS loads current user
  |
  v
NestJS loads diabetes profile + safety flags
  |
  v
NestJS builds PatternRequest with careMode + safetyTier
  |
  v
FastAPI runs only detectors allowed for that care mode
  |
  v
NestJS validates structured findings
  |
  v
Frontend renders evidence, limitations, and unsupported states
```

If the user has no profile yet, use `unknown` and return only descriptive or
insufficient-data findings. The UI should ask for profile setup before showing
care-mode-specific interpretations.

## Metabolic Engine Changes

Refactor the engine into a detector registry. Each detector declares where it is
allowed to run.

```python
Detector(
    name="post_meal_walk_effect",
    supported_care_modes={"type_2_standard", "type_2_insulin_supported", "prediabetes"},
    blocked_flags={"pregnancy"},
    requires_clinician_context=False,
)
```

Keep the existing Type 2 detectors as the first registry entries:

- `morning_glucose_pattern`
- `post_meal_response`
- `late_meal_effect`
- `post_meal_walk_effect`

Add new detectors only when their data requirements and safety posture are
clear.

| Mode | First useful detectors |
|---|---|
| `prediabetes` | A1c trend, fasting glucose trend, activity consistency, weight trend, meal timing association |
| `type_2_insulin_supported` | Existing Type 2 detectors plus medication-context annotations, no dose recommendations |
| `gestational` | Fasting pattern, post-meal pattern, missing-reading detection, clinician-report completeness |
| `type_1_cgm_insulin` | Descriptive CGM summaries first; insulin-aware analysis only after safety review |
| `other_specific` | Timeline quality, lab trend, medication record completeness, clinician packet |

Never make detector selection a frontend decision. The backend and engine must
enforce it.

## Safety Rules

Expand the existing experiment safety classifier into a profile-aware safety
service.

Inputs:

- Experiment template
- Care mode
- Active safety flags
- Medication context
- Clinician support status
- Requested change size

Outputs:

- `allowed`
- `clinician_gated`
- `blocked`
- `unsupported`

Rules:

- Unknown care mode means conservative behavior.
- Pregnancy means clinician-gated or blocked for most experiments.
- Any insulin dosing or correction advice is blocked.
- Medication dose and medication stopping remain blocked or clinician-gated.
- Exercise changes for high-risk users remain clinician-gated.
- Unsupported workflows must say "not supported yet", not silently fall back to
  Type 2 logic.

## Frontend Changes

Do not redesign the app around diabetes type. Add capability-aware surfaces.

Add:

- A short profile setup flow after account creation.
- A settings page section for diabetes profile and care context.
- Care-mode labels where they affect interpretation.
- Unsupported states in `/evidence`, `/log`, `/timeline`, and future
  experiment screens.
- Clinician-supported language for gestational, Type 1, and other specific
  forms.

Keep:

- The current landing page Type 2 focus until wider care modes are genuinely
  supported.
- The current `/evidence` route.
- The current evidence card structure: finding, number, sample count,
  confidence, limitations, what would improve it.

When broader support is ready, add separate audience paths rather than one
generic homepage:

- `/type-2`
- `/prediabetes`
- `/gestational`
- `/type-1`
- `/clinicians`

The main homepage can then route people to the right path without pretending
the same product promise applies to every diabetes context.

## FHIR-Oriented Mapping

The existing FHIR-oriented approach is correct. Extend it like this:

| Platform object | FHIR-oriented resource |
|---|---|
| `clinical.diabetes_profiles` | Condition plus Patient context |
| `clinical.diabetes_safety_flags` | Condition, Observation, or Flag-style internal mapping |
| Care-mode capabilities | Internal only |
| Clinician evidence packet | DocumentReference |
| Glucose samples | Observation |
| Medication records | MedicationStatement / MedicationRequest |
| Pregnancy context | Condition / Observation, depending on source |

Do not expose full FHIR APIs before the internal model is stable. Keep internal
objects FHIR-shaped so future export is possible.

## Rollout Plan

### Phase A: Make Type 2 Explicit

Add the profile tables, shared schemas, and backend profile endpoint. Backfill
seed/demo users as `type_2_standard`. Keep real users as `unknown` unless they
answer onboarding.

Success:

- Existing Type 2 `/evidence` behavior is unchanged.
- A user can view and update their diabetes profile.
- Every profile write is audited.

### Phase B: Capability Gates

Add care-mode capabilities and engine detector filtering.

Success:

- `/evidence` only runs detectors allowed for the user's care mode.
- Unknown and unsupported modes get clear unsupported states.
- Type 2 demo findings still match the current test expectations.

### Phase C: Prediabetes And Insulin-Treated Type 2

Prediabetes is close to the current evidence model. Insulin-treated Type 2 uses
the current data model but needs stricter language and safety boundaries.

Success:

- Prediabetes users can see lab and behavior trend evidence.
- Insulin-treated Type 2 users can use timeline/evidence safely without dose
  advice.

### Phase D: Gestational Clinician Packet

Build gestational only as a clinician-supported workflow.

Success:

- Pregnancy context is explicit.
- Evidence screens focus on completeness, fasting/post-meal summaries, and
  clinician-ready reporting.
- Experiments are mostly clinician-gated or blocked.

### Phase E: Type 1

Treat Type 1 as a later product, not a copy change. Build the device,
insulin-context, and safety foundation first.

Success:

- CGM and insulin context are imported with provenance.
- The product can describe patterns without dose instructions.
- A reviewed regulatory and clinical safety plan exists before any insulin-aware
  decision support is released.

## Testing Requirements

Add tests before exposing new care modes.

Backend:

- Profile create/update validation.
- Audit rows for every profile write.
- Care-mode capability derivation.
- Evidence requests include server-derived care mode, not browser-supplied care
  mode.
- Unsupported care modes return safe responses.

Shared types:

- Diabetes profile schema validation.
- Safety flag validation.
- Backward compatibility for existing `StructuredFinding` objects.

Metabolic engine:

- Existing Type 2 detector tests remain unchanged.
- Detector registry filters by care mode.
- Blocked flags prevent detector execution.
- Unknown mode returns conservative findings.

Frontend:

- Existing Type 2 evidence screen still renders.
- Profile setup works with keyboard and screen reader paths.
- Unsupported states are visible and understandable.
- No care-mode page promises advice the engine cannot safely produce.

Database:

- Migration is additive.
- Existing users and demo seed still work.
- Target ranges cannot be inverted.
- Profile is unique per user.
- Safety flags are queryable by user and time.

## Release Checklist

Do not call the product diabetes-wide publicly until these are true:

- The profile model is live.
- Care mode is server-derived and audited.
- Type 2 behavior is unchanged and tested.
- Unsupported modes fail safely.
- The engine registry blocks detectors by care mode and safety flags.
- The UI states the current support level plainly.
- Clinical review has covered gestational, Type 1, insulin, and pregnancy flows.
- Regulatory review has covered any feature that could be interpreted as
  medical device software or clinical decision support.
- HIPAA/security work is complete for the intended market and customer type.

## Source Guidance To Track

These sources should be checked during implementation and again before public
release:

- [ADA Standards of Care in Diabetes](https://professional.diabetes.org/standards-of-care):
  the current ADA standards are the clinical reference point for diabetes
  classification, technology, pregnancy, and care goals.
- [CDC Diabetes Basics](https://www.cdc.gov/diabetes/about/index.html):
  useful plain-language framing for the main diabetes categories.
- [FDA Clinical Decision Support Software guidance](https://content.govdelivery.com/accounts/USFDA/bulletins/32e8cb8):
  important for deciding when software functions may be regulated as device
  functions.
- [FDA Medical Device Software Guidance Navigator](https://www.fda.gov/medical-devices/regulatory-accelerator/medical-device-software-guidance-navigator):
  useful for mapping software features to potentially relevant FDA guidance.
- [HHS HIPAA Security Rule summary](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html):
  the baseline reference for protecting electronic protected health information
  if the product falls under HIPAA as a covered entity or business associate.

## Recommended First Implementation Ticket

Start with this ticket:

> Add diabetes profile, care mode, and safety flag foundations without changing
> the current Type 2 evidence behavior.

Acceptance criteria:

- New additive migration creates `clinical.diabetes_profiles` and
  `clinical.diabetes_safety_flags`.
- Shared schemas exist in `packages/types`.
- NestJS exposes authenticated profile read/update endpoints.
- Profile writes are audited.
- Demo seed creates a `type_2_standard` profile.
- `/api/evidence` still returns the same Type 2 findings for the demo user.
- Unknown profiles do not receive Type 2-specific findings.
- Tests cover profile validation, audit, and evidence routing.

