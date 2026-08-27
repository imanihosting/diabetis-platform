# Wellovue

Wellovue is a causal Type 2 diabetes platform. Most diabetes tools record what happened;
this one is built to help a person work out what is likely true for their own
body, what remains uncertain, and what safe next observation would reduce that
uncertainty.

> The product primitive is not "log glucose". It is: turn everyday diabetes data
> into personal, testable metabolic evidence.

See [docs/](./docs) for the product thesis, architecture, data model, and roadmap.

## Layout

```
frontend/           Next.js 15 · React 19 · TypeScript · Tailwind · TanStack Query
backend/            NestJS core API — identity, ingestion, timeline, audit
metabolic-engine/   Python · FastAPI — pattern detection and scientific computation
packages/types/     Shared API contract (@wellovue/types): Zod schemas + inferred types
infra/              Database migrations, provisioning notes, local Docker services
scripts/            Migration runner, demo seeder, VM provisioning
docs/               Product and technical documentation
```

The split follows one rule: **NestJS owns application state and user workflows;
the Python engine owns scientific computation.** Neither reaches into the
other's territory.

## Getting started

```bash
cp .env.example .env       # fill in the credentials
npm install
npm run infra:up           # Redis
npm run db:migrate         # apply schema to the database VM

npm run dev:backend        # http://localhost:4000/api  (docs at /api/docs)
npm run dev:frontend       # http://localhost:3000

cd metabolic-engine
python3 -m venv .venv && ./.venv/bin/pip install -e ".[dev]"
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

### Demo data

```bash
node --env-file=.env scripts/seed-demo.mjs
```

Seeds 60 days of plausible CGM readings, meals, walks, medication, and labs for
`demo.patient@wellovue.local` (password `demo-patient-password`).

The data encodes a known ground truth — walking after a meal genuinely blunts
the modelled rise by 1.3 mmol/L — so the pattern engine can be checked against
an answer we control. It also encodes a deliberate confound (late meals are
also the highest-carbohydrate ones) to verify the engine reports that
limitation rather than glossing over it.

### Running it in Docker instead

```bash
npm run docker:up          # build and start frontend, backend, engine, redis
npm run docker:logs
npm run docker:down
```

Uses the same provisioned database and object storage as a local run, with the
frontend on `:3000`, backend on `:4000`, engine on `:8000`.

## Checks

```bash
npm run typecheck          # backend + frontend + shared types
npm run lint
npm test                   # unit tests, no infrastructure needed
```

### Full test suite in Docker

```bash
npm run test:docker
```

Brings up a throwaway PostgreSQL and MinIO, applies the migrations, runs every
suite against them, and tears the stack down. Nothing touches the provisioned
VMs, so tests create and delete freely and a failed run leaves no residue.

The Postgres image carries the same extension versions as production
(timescaledb 2.29.2, vector 0.8.6), so hypertables, vector indexes, and the
PL/pgSQL guard triggers are exercised for real rather than mocked.

| Suite | Count | Needs infrastructure |
|---|---|---|
| `backend/test/*.spec.ts` | 21 | no |
| `backend/test/integration/schema-guards.spec.ts` | 18 | yes |
| `backend/test/integration/api.spec.ts` | 22 | yes |
| `metabolic-engine/tests` | 7 | no |

The engine's test stage also runs `ruff` and strict `mypy`, because a type
checker nobody enforces drifts out of compliance within a week.

### A note on `npm install`

This directory's name contains a space, and npm 11.6.2 silently produces an
incomplete dependency tree when installing under such a path — packages install
without error while some of their own dependencies are missing, which surfaces
much later as `Cannot find module 'vary'` or similar.

`package-lock.json` is therefore generated from a space-free path and committed;
use `npm ci` here rather than `npm install`. Renaming the directory (to
`diabetes-platform`, which also fixes the spelling) removes the problem
entirely.

To iterate on integration tests from your editor, start just the dependencies
and run the suite locally against them:

```bash
npm run test:stack:up      # postgres + minio + migrations, ports 55432 / 59000
npm run test:integration
npm run test:docker:down
```

`npm run test:docker:keep` leaves the stack up after a run for inspection.

### Engine checks

```bash
cd metabolic-engine
./.venv/bin/python -m pytest
./.venv/bin/ruff check .
```

## Design decisions worth knowing

**Provenance travels with every data point.** Every row that the platform did
not directly observe carries a `source` and a `confidence`, and the interface
shows both. A person deciding what to trust about their own body should not
have to hunt for the difference between a measurement and an estimate.

**The database enforces the safety rules, not just the application.** Predictions
are immutable, the audit trail is append-only, and a clinician-gated experiment
cannot be marked active without review — all enforced by triggers and check
constraints. See [infra/README.md](./infra/README.md).

**A finding is produced by a model, never by a language model.** The engine
returns structured findings with an effect estimate, a confidence, a sample
count, and explicit limitations. An LLM may rephrase such a finding; it must
never create one.

**Thin evidence is reported as thin evidence.** With too few samples the engine
returns an explicit "insufficient data" finding that names what would improve
it, rather than a confident-looking number built on three readings.

**Auth is on by default.** The JWT guard is registered globally; exposing a
route requires an explicit `@Public()` decorator, so nothing is exposed by
omission.

**No credential is readable by page JavaScript.** The refresh token — the
long-lived one — lives in an HttpOnly, SameSite=Strict cookie scoped to
`/api/auth`. The short-lived access token is held in memory for the tab's
lifetime and never written to storage. An XSS can use the session while it is
running; it cannot walk away with a credential that outlives the page.

**Health-data writes and their audit entries are atomic.** Every write commits
in one transaction with the audit row describing it. A stored measurement with
no record of who added it is not an acceptable outcome, so the audit write
throws rather than being swallowed.

**Migrations are plain SQL.** The schema uses TimescaleDB hypertables, pgvector
index types, and PL/pgSQL guard triggers that ORM migration DSLs model poorly.

## Safety boundaries

The platform helps a person understand patterns and prepare for conversations
with their clinician. It must not autonomously adjust medication, diagnose
complications, or give emergency advice.

| Category | Examples |
|---|---|
| Allowed | meal timing, post-meal walking, sleep observation, portion comparison, meal order |
| Clinician-gated | medication timing or dose, fasting protocols, major diet changes |
| Never in-app | insulin dosing, acute hypo/hyperglycemia treatment, emergency triage, stopping medication |

`classifyTemplate()` in `packages/types` is the single source of truth, and it
fails closed: an unrecognised template is gated, never allowed.

## Status

Phase 0 and the foundations of Phases 1–2 are in place:

- [x] Monorepo, shared contract package, local development environment
- [x] PostgreSQL 17 + TimescaleDB + pgvector, ten domain schemas, migrations
- [x] Authentication, audit logging, consent tables
- [x] Glucose entry, CSV import from CGM/meter exports, meal logging with photos,
      medication records, activity events
- [x] Unified metabolic timeline
- [x] Pattern engine v1 with structured findings
- [x] Containerised stack and an isolated Docker test environment
- [x] Rate limiting on public endpoints, and CI on every push
- [x] Evidence screen wired to the pattern engine through `GET /api/evidence`
- [ ] Prediction accountability API (tables and guards exist)
- [ ] Future Sandbox, Living Trials, Clinician Evidence Room

## Open decisions

These are called out in [docs/build-roadmap.md](./docs/build-roadmap.md) and are
not yet settled. The scaffold takes the reversible option in each case:

| Decision | Current placeholder |
|---|---|
| Authentication provider | Local JWT with argon2id, refresh token in an HttpOnly cookie. Credentials are isolated in `identity.credentials` so moving to OIDC means dropping one table, not reshaping users. |
| Embedding dimension | `vector(1536)`. Must be set to the real model's dimension before the first production migration — changing it later rewrites the table. |
| Hosting | None assumed. Everything is containerisable and environment-driven. |
| Target market and geography | None assumed. FHIR-shaped mappings keep records portable. |
