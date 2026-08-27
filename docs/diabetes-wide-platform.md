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

**Shipped in migration `0013_diabetes_profile.sql`.** What follows is what
exists, not a proposal. Three things differ from the original sketch, and each
difference is load-bearing rather than stylistic. They are recorded under
[Decisions That Should Not Be Reversed](#decisions-that-should-not-be-reversed)
so a later phase does not helpfully put them back.

The migration is additive. Nothing rewrites `clinical.conditions`,
`metabolic.glucose_samples`, `nutrition.meals` or `experiments.*`.

```sql
create table if not exists clinical.diabetes_profiles (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references identity.users(id) on delete cascade,
  diabetes_type       text not null,
  care_mode           text not null,
  diagnosed_on        date,
  diagnosis_source    text not null default 'self_reported',
  clinician_supported boolean not null default false,
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id),
  constraint diabetes_type_chk    check (diabetes_type in (...)),
  constraint care_mode_chk        check (care_mode in (...)),
  constraint diagnosis_source_chk check (
    diagnosis_source in ('self_reported','clinician','imported','assumed')
  )
);
```

`diagnosis_source` carries `assumed`, which the sketch did not have. Everyone
registered before this migration signed up to a product that only offers
Type 2, so they were backfilled as Type 2 — but nobody asked them. A profile
that cannot tell an answer from an assumption will eventually be trusted as
though someone had answered.

There is **no `safety_tier` column**. The tier is a function of the care mode
and the flags currently active, and a stored copy drifts from them: a pregnancy
flag gets written, the column still reads `standard`, and the safety service
asks the stale value. It is computed on every read by `deriveSafetyTier` in
`@wellovue/types`.

There are **no `target_low` / `target_high` columns yet**. 3.9 and 10.0 mmol/L
are currently hardcoded in five places across the frontend and the Python
engine. A per-user target added before those are unified is a column that looks
authoritative and that nothing reads, which is worse than no column: the next
person sets it, sees no change, and cannot tell whether the feature is broken
or absent. Unify the five sites behind one shared constant first, then add
these as a nullable override.

Safety flags are **append-only**, enforced by a trigger, like `audit.events`
and `ai.predictions`:

```sql
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
  constraint safety_flag_name_chk   check (flag in (...))
);

create trigger diabetes_safety_flags_append_only
  before update or delete on clinical.diabetes_safety_flags
  for each row execute function clinical.guard_safety_flag_append_only();
```

A flag is a claim about someone's risk at a moment in time. When the platform
believed a person was pregnant, or using insulin, is exactly the sort of record
that must not be quietly revised later.

Append-only means the history cannot be rewritten while the person has an
account. It does not mean the person cannot leave. Migration 0013 refused every
DELETE, and because `user_id` cascades from `identity.users` that made an
account with any recorded flag **impossible to erase** — GDPR erasure failed
with a message about append-only storage. Migration 0015 narrows the rule:
UPDATE is always refused, and DELETE is refused only while the referenced user
still exists, which is the one case where there is a subject left to protect.
Safety flags are health data about a person, so they leave with the account,
like glucose and meals and unlike `audit.events`. A flag is therefore resolved by
inserting a row saying so, and the current state of a flag is its most recent
row. That is why there is no `resolved_at` and no unique constraint on
`(user_id, flag)`: both belong to a mutable design, and this is not one.

Reading current flags means taking the latest row per flag and keeping it only
if that row says `active`. Filtering on `status = 'active'` alone resurrects
flags that were resolved, because the row that raised them is still there. The
query lives in one place in `DiabetesProfileService` for that reason.

The initial flag set:

- `insulin_therapy`
- `pump_or_automated_insulin_delivery`
- `pregnancy`
- `hypoglycemia_unawareness`
- `history_of_severe_hypoglycemia`
- `kidney_disease`
- `cardiovascular_risk`
- `paediatric_user`
- `clinician_managed_protocol`

These are not diagnoses. They are product safety context.

## Decisions That Should Not Be Reversed

Each of these looks like an omission and is not. Restoring any of them
reintroduces a specific failure.

| Decision | What reversing it breaks |
|---|---|
| `safety_tier` is derived, never stored | A stored tier goes stale against the flags it came from. The tier decides whether someone may run an experiment unsupervised, so it is the last value that should be allowed to be wrong while looking authoritative. |
| Safety flags are append-only | The history of what the platform believed about someone's risk, and when, becomes rewritable. A resolved flag must leave the row that raised it in place. |
| No `target_low` / `target_high` until the five hardcoded sites are unified | A column nothing reads teaches the next person that the feature is broken. Adding a column later is an `ALTER`; removing one that has been lying to people is not. |
| Care mode is derived server-side, never accepted from a client | A request could otherwise ask for a Type 1 record to be analysed by Type 2 detectors. |
| Existing accounts backfilled to `type_2_standard`, source `assumed` | Leaving them `unknown` is conservative in name only: it takes the evidence screen away from people whose data has not changed and whose findings were correct yesterday. |
| Nothing added to `PatternRequest` until the engine can act on it | An unused field is a lie with a schema, and the next person cannot tell whether the engine honours it. |
| New accounts are `unknown`/`unanswered`, not `type_2`/`assumed` | There is now a way to ask, so guessing is a choice rather than a constraint, and guessing wrong means reading someone's data with the wrong model of their body. |
| `unanswered` is a separate source from `assumed` | The absence of a claim is not a weaker version of a claim that could be wrong. Collapsing them loses the only signal that says whether anyone was ever asked. |
| Safety flags may be deleted by account erasure, never otherwise | Refusing every DELETE made an account with any flag impossible to erase. The guarantee is that history cannot be rewritten while the person has an account. |
| The engine gate does not replace the NestJS gate | One enforcement point opens the moment something new calls the service. The two are redundant on purpose. |
| The engine never reads the diabetes profile | Care mode arrives in the request, so there is one source of truth for the value that decides which analysis runs. |
| `careMode` defaults to `unknown` in the engine, not to Type 2 | An omitted field must fail closed. The caller that forgets it is the one least likely to have considered whose record it is analysing. |
| Every `would_improve_with` entry comes from `suggestions.py` | A suggestion the product cannot honour sends someone looking for a control that is not there. Free text cannot be checked; a catalogue can. |
| Lab test names are matched case-insensitively | A lab import writes whatever the source called the test. An exact match told a demo record with eight HbA1c results that it had none. |
| A lab's unit comes from the data, never from the detector | HbA1c is reported in % and in mmol/mol. Assuming one labels the other's numbers wrongly, on scales an order of magnitude apart. |
| Prediabetes detectors are not offered to Type 2 | They would likely be useful there, which is exactly why switching them on by assumption would make "Type 2 is unchanged" untestable. |
| `classifyTemplate` requires a profile context, and there is no second entry point | A safety classifier with a permissive default is one forgotten argument from allowing what it exists to stop, and one with two ways in will eventually be called through the wrong one. |
| Every rule in the classifier can only tighten | A clause added later cannot grant a permission, so none can accidentally unblock insulin dosing. |
| `safetyFlags` carries the flags in force, not the stored history | The flag table is append-only, so filtering the history on `status === 'active'` resurrects flags that ended. That derivation happens once, in SQL. |
| The insulin boundary appears only where insulin is involved | A boundary that appears everywhere is read nowhere. |
| A prediction's body and snapshot are generated server-side | A record of how often the platform was right is worth nothing if the platform chose the answer after seeing the question. |
| Immutable means "cannot be revised while it belongs to somebody" | Read as "can never be deleted", it made accounts that had made a prediction impossible to erase. Twice: the trigger and a `restrict` foreign key. |
| A blocked experiment gets no prediction | It will never run, and an immutable expectation about something that cannot happen is noise in the accountability record. |
| An experiment cannot become active without a prediction | Enforced by trigger, not only by the service that starts one. An invariant held up by the code currently calling is an invariant until somebody writes different code. |
| `ai.predictions.experiment_id` is frozen like the rest of the row | Reassignment is the same failure as editing: the expectation ends up attached to a question it was not made about. |
| The packet reads labs over two years, not the packet's period | HbA1c is drawn quarterly. A ninety-day window holds one measurement and a thirty-day window often none, and a single point is the shape of data a summary is least use for. The window differs from the heading and the page says so. |
| A lab series in two units is shown without a change | HbA1c is reported in `%` and in `mmol/mol`, an order of magnitude apart. Subtracting across them produces a confident number that means nothing. The engine already refuses the same comparison. |
| The packet raises a missed prediction on direction, never on magnitude | Any threshold for "how far off is worth mentioning" would be a number invented in the code and then quoted in a consulting room as though it meant something. A sign that disagrees needs no cutoff. |
| Nothing in the packet is composed at render time | Every item raised comes from a finding the model flagged or an experiment that went the other way, and a question appears only when the shared proposal catalogue already holds one. A plausible sentence a clinician reads as a claim is the most expensive thing this product could get wrong. |
| A care mode with no detectors gets a reason, not an empty findings list | A clinician reading a blank section would reasonably take it for "nothing was found", which is a different claim from "this was never analysed". |
| The packet leaves out drafts and refusals | A proposal nobody started says nothing about the person in the room, and a refused one would put an experiment the product declined in front of a professional as though it were part of their care. |
| Two fixed periods, thirty days and ninety | An arbitrary window would let the period be chosen after the answer is seen, which is an editable prediction in different clothes. |
| An outcome is written once and never edited | A prediction that cannot be revised beside an outcome that can is an accountability chain missing the link that holds the answer. Enforced by trigger since 0019, on top of the unique constraint that stops a second row. |
| An experiment cannot be completed without an outcome | The mirror of the prediction guard. A loop that writes down what it expects and then finishes without saying what happened keeps only the flattering half of its own record. `abandoned` is deliberately not guarded: giving up unmeasured is an honest end. |
| One experiment, one prediction | Two expectations attached to one trial makes "what was predicted" a question with two answers, and whichever a screen shows was chosen after the fact. |
| An outcome can only be recorded by completing the experiment | An outcome written on its own leaves the trial it settles running with its answer already known — a state nothing clears. Two doors into the same write are how the two eventually disagree. |
| A prediction can only be written by starting an experiment | The endpoint that wrote one on its own produced only rows nothing could measure: finishing a trial requires it to have run, so an expectation recorded against one that never started could never be scored. |
| Predicted and observed are shown in the same ink, uncoloured | Colour in this product means where a glucose value sits relative to target, or how far a finding can be trusted. A green number for "we were right" is a third meaning invented to flatter the platform. |
| An experiment that has been started cannot be deleted | Its prediction cascades from it and refuses to go while the account exists. Removing the record of what was expected by deleting the thing it was about is the loophole that would make every accuracy figure optional. Erasing the account still works. |

## Shared Type Changes

**Shipped in `packages/types/src/diabetes.ts`.** Schemas:

- `diabetesTypeSchema`, `careModeSchema`, `safetyTierSchema`
- `diagnosisSourceSchema`, `safetyFlagSchema`, `safetyFlagStatusSchema`
- `diabetesProfileSchema`, `diabetesSafetyFlagSchema`
- `updateDiabetesProfileSchema`, `recordSafetyFlagSchema` (client input)
- `careModeCapabilitiesSchema`

And the three functions the safety posture depends on, shared so the API, the
app and any future report cannot disagree:

- `deriveCareMode(diabetesType, activeFlags)` — insulin moves Type 2 into the
  insulin-supported mode; pregnancy outranks the recorded diagnosis, because a
  gestational context is about what the body is doing now rather than what was
  written down before.
- `deriveSafetyTier(careMode, activeFlags)` — most severe wins, and flag order
  must not change the answer.
- `careModeCapabilities(careMode, activeFlags)` — what the product will do for
  this person today, plus the sentence explaining why when the answer is "not
  yet".

`updateDiabetesProfileSchema` deliberately has no `careMode` field. It is
derived, and a schema that accepted it would be the hole.

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

**Shipped** as `DiabetesProfileModule`:

| Endpoint | Purpose | Auth |
|---|---|---|
| `GET /api/diabetes-profile` | Profile, active flags, and capabilities in one response | Required |
| `PUT /api/diabetes-profile` | Update the recorded diagnosis. Care mode is recomputed, not accepted | Required |
| `POST /api/diabetes-profile/flags` | Record a flag. Append-only: ending one means recording that it ended | Required |
| `GET /api/diabetes-profile/flags` | Every flag ever recorded, newest first | Required |

No separate `/capabilities` endpoint. Every caller that wants the care mode
also wants to know what it permits, and splitting them invites a caller to act
on one without the other.

Every write must create an audit event. Treat profile changes as health-data
changes, not account preferences.

## Evidence Routing

Keep `GET /api/evidence` as the public product route inside the signed-in app.
Change what happens behind it:

**Shipped (Phase A).** NestJS owns the gate, and the engine is untouched:

```text
GET /api/evidence
  |
  v
NestJS loads current user
  |
  v
NestJS loads diabetes profile + active safety flags
  |
  v
capabilities.evidenceEnabled ?
  |                    \
  | yes                 \ no
  v                      v
FastAPI runs the        NestJS returns a single
Type 2 detectors        `care_mode_unsupported` finding
  |                      |
  v                      v
NestJS orders and validates structured findings
  |
  v
Frontend renders evidence, limitations, and unsupported states
```

One place decides, so there is no chance of two answers. Moving the decision
into the engine's detector registry is Phase B, and NestJS stays the workflow
gate afterwards: the engine refuses to run a detector, the backend refuses to
ask.

A user with no profile row reads as `unknown`, which is identical in effect to
a profile that says `unknown` — the platform knows exactly as little in both
cases.

The unsupported answer is shaped like every other finding: a summary, its
limitations, and what would change it. "We do not analyse this yet" is a real
answer and belongs in the same frame as the others. A 404 or an empty list
would let the screen imply the question was never asked.

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

The first step of this exists: `careModeCapabilities` already returns
`experimentsEnabled`, which is false above the standard safety tier regardless
of care mode. `classifyTemplate` in `packages/types/src/experiments.ts` is
still template-only and still fails closed — an unrecognised template is gated,
never allowed. Making it profile-aware must preserve that: the 11 tests in
`backend/test/safety.spec.ts` assert it, and they should keep passing
unchanged.

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

Nothing on the frontend has been built yet. `/evidence` renders the
`care_mode_unsupported` finding through the ordinary finding card, which reads
acceptably and was not designed for it; Phase B step 3 is the designed state.

Add:

- A short profile setup flow after account creation (Phase B step 1).
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

### Phase A: Make Type 2 Explicit — SHIPPED

Migration `0013`, `packages/types/src/diabetes.ts`, `DiabetesProfileModule`,
and the care-mode gate on `/evidence`. Applied to the platform database; all
existing accounts backfilled to `type_2_standard` with source `assumed`.

Verified:

- Existing Type 2 `/evidence` behaviour unchanged — the demo record returns the
  same four findings, in the same order, from the same engine version.
- A user can read and update their profile, and every write is audited.
- Flipping an account to Type 1 returns `care_mode_unsupported` and no Type 2
  finding leaks; restoring returns all four.
- The append-only trigger is tested by attacking it directly over SQL.

Two things Phase A left deliberately unfinished, both listed first in Phase B:
new registrations get `type_2_standard`/`assumed` rather than `unknown`,
because onboarding does not exist yet and `unknown` would be a dead end with no
way out; and the frontend has no designed treatment for the unsupported
finding, so it currently renders through the ordinary finding card.

### Phase B: Setup Flow, Then Capability Gates

**Phase B is complete.** Steps 1 to 3: migrations `0014` and `0015`,
`/profile`, and the `UnsupportedCareMode` surface. Steps 4 to 6: the detector
registry in `metabolic-engine/app/engines/registry.py`, `careMode` and
`activeFlags` on `PatternRequest` in both languages, and the direct-path tests
in `backend/test/integration/engine-gate.spec.ts`.

Enforcement is now genuinely two-layer. NestJS refuses to *ask* for an analysis
it should not request; the engine refuses to *run* one it should not perform.
Neither defers to the other, which is what makes the second one worth having:
the request the engine refuses is one the backend never sends, so testing
through the API proves nothing about the engine. The direct-path tests call it
over HTTP the way a future service, a background job, or a mistake would.

The engine defaults `careMode` to `unknown`, which no detector supports, so a
caller that omits the field gets a refusal rather than the Type 2 analysis —
and that caller is the one most likely to be pointing at a record nobody
thought about.

In this order. Steps 1 and 2 had to land together: switching the default to
`unknown` before there is a way to answer the question strands every new
account on a screen that refuses to help them.

1. **Care-profile setup after signup.** — SHIPPED. The shortest flow that can set
   `diabetesType` and the flags that change the care mode. Keyboard and screen
   reader paths included, since this gates the whole product.
2. **Switch new users to `unknown`.** — SHIPPED. Change the default in
   `DiabetesProfileService.createForNewUser` and the registration transaction.
   Existing accounts keep their backfilled `type_2_standard`; this is about
   people who have not answered yet, not about revoking an answer.
3. **Design the unsupported evidence state.** — SHIPPED. A real treatment for
   `care_mode_unsupported` on `/evidence`, distinct from a finding, that states
   the support level plainly and points at the profile. Currently it falls
   through the ordinary card, which reads acceptably and was not designed for
   it.
4. **Add `careMode` to `PatternRequest`** — SHIPPED. — and not before the engine registry
   exists to act on it. The contract is mirrored in `packages/types/src/insights.ts`
   and `metabolic-engine/app/models/findings.py`, and those two are the same
   contract in two languages: change them together.
5. **Move the gate into the engine's detector registry.** — SHIPPED. Each detector
   declares the care modes it supports and the flags that block it. NestJS
   stays the workflow gate: the engine refuses to run a detector, the backend
   refuses to ask. Two independent refusals, not one moved.
6. **Keep the current Type 2 findings as the regression test.** — SHIPPED. The demo
   record's four findings, their order and their effect estimates are the
   contract for "nothing broke". If they change, something did.

Success:

- A new account can answer the question and reach evidence in one sitting.
- `/evidence` runs only detectors allowed for the user's care mode, enforced in
  the engine.
- Unknown and unsupported modes get a designed state, not a fallen-through one.
- Type 2 demo findings still match the current test expectations exactly.

### Phase C: Prediabetes And Insulin-Treated Type 2

**Prediabetes is shipped.** `LabsModule` with audited create/list, a lab entry
tab on `/log` for HbA1c, fasting glucose, weight and BMI, `load_labs` in the
engine, and five detectors gated to `prediabetes`: `hba1c_trend`,
`weight_trend`, `fasting_glucose_trend`, `activity_consistency`,
`meal_timing_association`. Type 2 returns the same four findings it always did.

Lab detectors look back two years regardless of the requested window. The
window on an evidence request describes a period of behaviour; a quarterly test
has nothing to say inside thirty days, and reporting "not enough results" to
somebody with four years of them would be false. The finding says it looked
further back than the screen is showing.

**Insulin-treated Type 2 is shipped, as a safety and language layer only.**
`classifyTemplate` now requires a `SafetyProfileContext` — care mode plus the
flags in force — and every rule in it can only tighten the answer, so no clause
added later can accidentally unblock insulin dosing. `medication_dose` becomes
`blocked` wherever insulin is involved; `medication_timing` stays
`clinician_gated`, because moving a dose earlier or later is a real question a
clinician can supervise and blocking it pushes that conversation out of the
product. The Evidence screen carries an explicit boundary above the findings
for anyone on insulin, and nowhere else.

No insulin-specific detectors, deliberately. The analysis is the same
physiology read the same way; what needed hardening was the safety primitive
and the language around it.

**This does not ship experiment safety end to end.** Nothing calls
`classifyTemplate` — there is no experiments endpoint. It is the contract the
database's check constraints mirror, hardened now so that experiment work
starts from the right primitive rather than retrofitting one.



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

Add tests before exposing new care modes. Ticked items exist today.

Backend (`backend/test/diabetes-profile.spec.ts`,
`backend/test/integration/diabetes-profile.spec.ts`):

- [x] Profile create/update validation.
- [x] Audit rows for every profile write.
- [x] Care-mode capability derivation, including that flag order cannot let a
      milder flag mask a severe one.
- [x] A client-supplied `careMode` is ignored: the request sends
      `type_1` with `careMode: type_2_standard` and asserts the server derives
      `type_1_cgm_insulin`.
- [x] Unsupported care modes return a stated finding, and no Type 2 finding
      leaks into the response.
- [x] The append-only trigger, attacked directly over SQL.
- [ ] Profile setup flow (Phase B step 1).

Shared types:

- [x] Diabetes profile schema validation.
- [x] Safety flag validation, including rejecting an unrecognised flag name.
- [x] `careModeCapabilities` covers every member of the care-mode enum, so a
      mode added to the contract cannot fall through to a default.
- [x] Backward compatibility for existing `StructuredFinding` objects: the
      contract is unchanged, and `care_mode_unsupported` is an ordinary
      finding rather than a new shape.

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

## Next Implementation Ticket

None. Ticket 5 shipped and the loop the product promises is closed end to end:
collect, one timeline, find patterns, propose a safe test, write the prediction
down first, measure the result against it, and hand a clinician a page they can
read in a minute.

`GET /api/reports/clinician?days=30|90` assembles that page on the server, from
the same services the app's own screens read — findings through
`EvidenceService`, so the care-mode gate stays in the path; glucose through the
same summary the timeline shows; experiments with the expectations frozen
before each ran. `/report` renders it. Nothing on it is written at render time.

What is left is no longer a sequence, and the order is a judgement worth making
deliberately:

- **The go-live blockers.** Neither is code, and the database TLS one is
  blocked on a DNS name before a certificate can be bought — the only item here
  with a lead time.
- **Exporting the packet.** It is a web page and nothing else. A printed sheet
  is what gets carried into an appointment.
- **Weighing competing explanations.** The last loop step still labelled "Being
  built" publicly, and the only remaining item that changes what the engine
  says rather than how it is presented.
- **Recording a clinician's agreement**, so a gated experiment can stop waiting
  forever.

Gestational and Type 1 stay parked behind clinical review. Per-user target
ranges still wait on something ready to honour them.
