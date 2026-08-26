# Build Roadmap

## Product North Star

Build a Type 2 diabetes platform that helps a person discover what is true for their own body.

The product should gradually answer:

- What happened?
- What likely caused it?
- What are the competing explanations?
- What safe observation or behavior experiment would reduce uncertainty?
- What evidence should I bring to my clinician?

## Phase 0: Foundation

Goal: create the technical base and prove that the platform can hold a clean metabolic timeline.

Build:

- Monorepo structure
- Next.js web app shell
- NestJS API shell
- FastAPI metabolic engine shell
- PostgreSQL with TimescaleDB and pgvector
- Redis
- S3-compatible object storage
- Shared TypeScript types
- Basic authentication
- Audit event table

First success condition:

> A user can create an account, add glucose readings, meals, medication records, and activity events, then view them on one timeline.

## Phase 1: Personal Metabolic Timeline

Goal: make the product useful before advanced AI.

Build:

- Manual glucose entry
- CSV import for CGM or glucose-meter exports
- Meal logging with photo attachment
- Medication record logging
- Activity and sleep import placeholder
- Timeline view
- Daily and weekly glucose summaries
- Data source and confidence indicators

Do not overbuild food recognition yet. The timeline and data model matter more.

## Phase 2: Pattern Engine

Goal: find repeatable personal patterns.

Build:

- Post-meal glucose response analysis
- Overnight and morning glucose pattern detection
- Walking-after-meal association detection
- Late-meal association detection
- Sleep correlation exploration
- Confidence and sample-count display

Output should be structured findings, not freeform AI advice.

Example:

```json
{
  "pattern": "late_evening_meal_response",
  "summary": "Late evening meals are followed by longer glucose recovery.",
  "sample_count": 14,
  "confidence": 0.76,
  "limitations": ["Meal composition varies", "Sleep data is incomplete"]
}
```

## Phase 3: Prediction Accountability

Goal: make the system measure whether its predictions work.

Build:

- Prediction storage
- Input snapshot storage
- Model version tracking
- Outcome matching
- Prediction error reporting
- User-facing confidence explanation

First prediction types:

- Meal glucose peak
- Time above target after meal
- Recovery time after meal
- Morning glucose risk band

Hard rule:

> Predictions are immutable. Outcomes are attached later.

## Phase 4: Future Sandbox

Goal: let users simulate simple choices before making them.

Build:

- Meal simulation input
- Scenario comparison
- Walking-after-meal scenario
- Portion-size scenario
- Meal timing scenario
- Confidence and limitation display

The product copy should avoid moralizing food. It should present tradeoffs.

Example:

```text
Scenario A: eat as logged
Likely peak: 10.4 mmol/L
Confidence: moderate

Scenario B: same meal plus 12-minute walk
Likely peak: 9.1 mmol/L
Confidence: moderate
```

## Phase 5: Living Trials

Goal: turn uncertainty into safe personal experiments.

Build:

- Hypothesis generation
- Experiment eligibility checks
- Safe experiment templates
- Experiment protocol builder
- Result analysis
- Personal intervention library

Initial safe experiment templates:

- Same breakfast, different walk timing
- Similar dinner, earlier vs later timing
- Same meal order vs protein-first order
- Similar meal with shorter vs longer post-meal walk
- Sleep tagging for morning glucose pattern investigation

Clinician-gated experiment templates:

- Medication timing
- Fasting protocols
- Major diet changes
- Exercise changes for users with cardiovascular risk

## Phase 6: Clinician Evidence Room

Goal: turn personal data into useful clinical context.

Build:

- 30-day and 90-day diabetes brief
- Medication response summary
- Lab trend summary
- CGM/glucose summary
- Experiment results summary
- Questions-for-clinician generator
- PDF export
- FHIR-oriented export groundwork

The clinician should receive a decision packet, not hundreds of charts.

## Phase 7: Diabetes Passport

Goal: create a portable longitudinal diabetes record.

Build:

- Medication history
- Condition history
- HbA1c and lab history
- Kidney, eye, foot, blood pressure, lipids monitoring status
- Side-effect history
- Proven personal interventions
- Failed personal interventions
- Exportable summary

This becomes more valuable as the person changes clinicians, medications, devices, and care settings.

## Phase 8: Mobile App

Goal: move high-frequency interactions to the phone.

Build:

- React Native / Expo app
- Quick meal capture
- Quick symptom/stress tagging
- Medication logging
- Experiment reminders
- HealthKit integration
- Health Connect integration
- Push notifications

Mobile should not wait until everything else is finished, but the web/API/data foundation should come first.

## MVP Scope

The first MVP should include:

- Account creation
- Manual and CSV glucose import
- Meal logging
- Medication logging
- Activity tagging
- Metabolic timeline
- Basic pattern engine
- Immutable predictions
- First clinician evidence brief

The first MVP should not include:

- Autonomous medical advice
- Medication adjustment recommendations
- Full FHIR certification
- Complex food-photo recognition
- Insurance integrations
- Multi-clinic workflow
- Claims about reversing diabetes

## Technical Milestones

| Milestone | Output |
|---|---|
| M1 | Monorepo, local services, database migrations |
| M2 | Auth, user profile, audit log |
| M3 | Glucose, meal, medication, activity data entry |
| M4 | Metabolic timeline |
| M5 | Pattern engine v1 |
| M6 | Prediction accountability tables and API |
| M7 | Future Sandbox v1 |
| M8 | Living Trials v1 |
| M9 | Clinician evidence brief |
| M10 | Mobile capture app |

## Open Decisions

These should be decided before implementation:

- Authentication provider: Keycloak, Auth0, Clerk, or cloud-native OIDC.
- Hosting provider: AWS, GCP, Azure, Fly.io, Render, or another managed platform.
- Target market first: direct-to-consumer, clinician-supported, employer benefit, or research partner.
- Geography first: US, UK/Ireland, EU, or another regulatory context.
- First data source: manual entry, CGM export, Apple Health, Health Connect, or lab import.

## Recommended First Build Sprint

Sprint length: 2 weeks.

Build:

- Monorepo
- Local Docker development environment
- PostgreSQL with schemas and migrations
- NestJS API health check and user module
- FastAPI service health check
- Next.js timeline screen
- Glucose sample import endpoint
- Manual meal logging endpoint
- Basic audit logging

Demo at end of sprint:

> A user uploads glucose data, logs a meal, and sees both on a metabolic timeline with source and confidence labels.

