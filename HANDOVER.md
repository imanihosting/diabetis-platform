# Handover

State of Wellovue as of 27 August 2026, at commit `975a468`.

Read this before changing anything. Several decisions below look arbitrary and
are not, and a few traps in this repo will cost you an hour if you meet them
cold.

Every count here was checked against the repo and the running database rather
than recalled.

---

## 1. What this is

A causal diabetes platform. Most diabetes tools record what happened; this one
is built to work out what is likely true for one person's body, how confident
anyone should be about it, and what safe next observation would reduce the
uncertainty.

> The product primitive is not "log glucose". It is: turn everyday diabetes
> data into personal, testable metabolic evidence.

| | |
|---|---|
| Design context, voice, anti-references | `PRODUCT.md` |
| Original spec (thesis, architecture, data model, roadmap) | `docs/` |
| Diabetes-wide expansion, and the decisions taken along the way | `docs/diabetes-wide-platform.md` |
| Infrastructure, guarantees, security posture | `infra/README.md` |
| Setup and checks | `README.md` |

`docs/diabetes-wide-platform.md` is the live working document. It carries a
**Decisions That Should Not Be Reversed** table explaining what breaks if each
is undone, and a **Next Implementation Ticket** section that is kept current.
Start there.

## 2. Layout

```
frontend/           Next.js 15 · React 19 · Tailwind · TanStack Query
backend/            NestJS 11 core API
metabolic-engine/   Python 3.12 · FastAPI — pattern detection
packages/types/     @wellovue/types — Zod schemas shared by all three
infra/              migrations, provisioning, Docker
scripts/            migration runner, seeders, TLS verifier, VM provisioning
```

The split follows one rule: **NestJS owns application state and workflows; the
Python engine owns scientific computation.** Neither reaches into the other.

## 3. Where the product is

The loop the product promises is: collect data, build one timeline, find
patterns, propose a safe test, **write down the prediction before it runs**,
measure the result against it, and turn that into something a clinician can
read. Six of seven steps exist. The last two are Tickets 4 and 5.

**Built and working.**

- Auth (argon2id, JWT, rotating single-use refresh token), audit trail, consent
  tables
- Ingestion: glucose by hand and by CGM/meter CSV, meals with photos,
  medication, activity, and labs/body measurements
- The unified metabolic timeline
- Diabetes care profile: Type 1, Type 2, gestational, prediabetes,
  other-specific and unknown are all representable
- Evidence for Type 2 and prediabetes, refused for every other care mode
- Experiment safety: proposals classified against the care profile, persisted
  with the decision, re-checked by database constraints
- Predictions: immutable, server-generated, attributed to an engine version
- Starting an experiment, with its prediction written in the same transaction
- Rate limiting on public endpoints; CI on every push
- Public site: landing, About, How this works, Contact, and the policy pages

**Not built.** Named plainly on the public pages too, which matters — see §7.

- Measuring a result against its prediction (the outcome endpoint exists; the
  screen and experiment completion do not)
- The clinician evidence packet
- Any frontend for *starting* an experiment. `/experiments` lists them
  read-only. This is a deliberate hold: starting one is the first irreversible
  thing a person can do here, and it should arrive with the screen that shows
  what happens next
- Gestational and Type 1 workflows. Both need clinical review before either
  starts
- Sleep capture. `metabolic.sleep_sessions` exists with no write path
- Per-user target ranges. Deliberate; see §6

## 4. Running it

```bash
npm ci                    # NOT npm install — see the traps
npm run db:migrate
npm run dev:backend       # :4000
npm run dev:frontend      # :3000
```

Or the whole thing in containers:

```bash
npm run docker:up         # frontend :3000, backend :4000, engine :8000, redis
npm run docker:down
```

**The containers serve built images.** Editing a file changes nothing at :3000
until `npm run docker:up` runs again. A route that only exists in new code is
the quickest check: 404 becoming 401 proves the image is current. `docker ps`
reports `healthy` from a stale image, so it proves nothing.

Demo account: `node --env-file=.env scripts/seed-demo.mjs` seeds 60 days for
`demo.patient@wellovue.local` / `demo-patient-password`. The data encodes a
known ground truth (walking after a meal blunts the rise by 1.3 mmol/L) so the
engine can be checked against an answer we control — it currently recovers
about -1.05.

`scripts/seed-user.mjs <email>` adds data to an account that already exists,
without deleting anything. Use it rather than `seed-demo.mjs` on any account a
person actually uses: the demo seeder opens by deleting the user, which takes
their password and every real record with it.

## 5. Tests

```bash
npm test                  # 71 unit, no infrastructure needed
npm run test:docker       # everything, in a throwaway stack
```

`test:docker` brings up its own PostgreSQL, MinIO and metabolic engine,
migrates, runs every suite, and tears down. Nothing touches the provisioned
VMs. The Postgres image carries the same extension versions as production, so
hypertables, vector indexes and the guard triggers are exercised for real.

| Suite | Count | Needs infra |
|---|---|---|
| `backend/test/*.spec.ts` | 71 | no |
| `backend/test/integration/api.spec.ts` | 58 | yes |
| `backend/test/integration/experiments.spec.ts` | 18 | yes |
| `backend/test/integration/schema-guards.spec.ts` | 19 | yes |
| `backend/test/integration/predictions.spec.ts` | 16 | yes |
| `backend/test/integration/diabetes-profile.spec.ts` | 14 | yes |
| `backend/test/integration/labs-prediabetes.spec.ts` | 9 | yes |
| `backend/test/integration/engine-gate.spec.ts` | 7 | yes |
| `backend/test/integration/throttle.spec.ts` | 5 | yes |
| `metabolic-engine/tests` | 29 | no |

To iterate from an editor: `npm run test:stack:up` then
`npm run test:integration`. **Wait for the migrate container to finish** before
running, or the first run will fail confusingly.

The engine's Docker test stage also runs `ruff` and strict `mypy`, because a
type checker nobody enforces drifts within a week.

A few suites are worth knowing about by name:

- **`schema-guards.spec.ts`** attacks the database's guarantees directly over
  SQL. Every safety invariant in this platform is enforced by the schema as
  well as the code, and this is what proves the schema half still works.
- **`engine-gate.spec.ts`** calls the metabolic engine over HTTP, bypassing
  NestJS entirely. Everything else reaches the engine through the backend,
  which never sends the request the engine is supposed to refuse — so those
  tests prove the backend behaves and nothing about the engine.
- **`target-range.spec.ts`** reads `thresholds.py` and fails if its numbers
  disagree with the shared contract. Python cannot import TypeScript; this is
  what stops the copy drifting.

---

## 6. Decisions that should not be casually undone

`docs/diabetes-wide-platform.md` holds the full table with the failure each
reversal causes. The load-bearing ones:

**The database enforces the safety rules, not the application.** Predictions
are immutable, the audit trail is append-only, safety flags cannot be
rewritten, a clinician-gated experiment cannot skip review, a blocked one can
never run, and an experiment cannot become active without a prediction attached
to it. All triggers and check constraints, all tested by attacking them
directly over SQL.

**Two independent gates, neither trusting the other.** NestJS refuses to *ask*
the engine for an analysis it should not request; the engine refuses to *run*
one it should not perform. A gate with a single enforcement point opens the
moment something new calls the service, and the engine answers about any user
id it is handed.

**Anything that decides what happens to health data is derived on the server.**
Care mode, safety tier, experiment safety status, whether clinician review is
required, and the entire content of a prediction. A browser supplies the
question; the server supplies the answer. `careMode` on `PatternRequest`
defaults to `unknown`, which no detector supports, so a caller that forgets it
gets a refusal rather than the Type 2 analysis.

**Immutable means "cannot be revised while it belongs to somebody".** Read as
"can never be deleted", it makes accounts impossible to erase, because these
tables cascade from `identity.users`. That was live in `ai.predictions` from
migration 0007 and unnoticed until the first code that wrote one.
`ai.prediction_outcomes` blocked erasure a second time with `on delete
restrict`. PostgreSQL removes the parent before cascading, so the triggers tell
erasure from rewriting by asking whether the user still exists.

**Erasure unlinks identity; it does not delete history.** Migration `0010`
permits exactly one kind of update to `audit.events`: clearing the actor and
subject. This is what lets GDPR erasure coexist with an audit trail worth
having.

**Writes and their audit entries are atomic.** Every health-data write commits
in one transaction with the audit row describing it. `recordBestEffort` exists
for the rare deliberate exception and is named so you can grep for it.

**A finding comes from a model, never from a language model.** Every finding
carries an effect estimate, confidence, sample count and explicit limitations.
When data is thin the answer is "not enough data" plus what to log.

**Every suggestion names something the product can record today.** Enforced:
`metabolic-engine/app/engines/suggestions.py` is a catalogue, each entry
annotated with its capture path, and the engine tests fail if a detector emits
anything else. An audit against that rule found four existing violations —
findings asking for sleep the product cannot store, meal end times the form
does not collect, walking intensity nothing captures, and Living Trials, which
do not exist. Where the useful improvement is genuinely not capturable it
belongs in `limitations`, where saying "sleep was not accounted for" is honest
and "log your sleep" is not.

**The target range is declared once**, in `packages/types/src/glucose.ts`.
There are no per-user target columns, deliberately: a column nothing reads is
worse than no column, because the next person sets it, sees no change, and
cannot tell whether the feature is broken or absent. Add them when something is
ready to honour them.

**Colour is reserved for meaning.** One palette across both surfaces: warm
paper, warm ink, and colour only for glucose relative to target and for
evidence strength. No teal or blue anywhere, deliberately. `-text` variants
exist because a coloured glyph beside a sentence is text and must clear 4.5:1,
while a filled shape only needs 3:1.

**Atkinson Hyperlegible is a functional choice.** The Braille Institute drew it
for low vision, and retinopathy is a complication of the condition this serves.
The mono cut is reserved for measured values.

---

## 7. The public pages must not promise what is not built

`PRODUCT.md` says the page renders the real thing, and that a health product
faking its own screenshots has already told you something. That is enforced by
convention rather than by code, so it needs watching.

Four of the seven loop steps on `/how-it-works` are marked **"Being built"**.
The proposed-trial panel and the clinician packet on the landing page are
labelled the same way, because they are designs for things that do not exist
while every other component there renders real output against real seeded data.
The landing page's finding quotes the strings the engine actually emits.

If you build one of those, remove its label. If you add a claim, check it is
true first.

---

## 8. Traps in this repo

These have all cost time once already.

**`npm install` is broken here.** The directory name contains a space, and npm
11.6.2 silently produces an incomplete dependency tree under such a path: 526
packages instead of 767, with packages missing their own dependencies. It
surfaces much later as `Cannot find module 'vary'`. `package-lock.json` is
generated from a space-free path and committed. **Use `npm ci`.** Renaming the
directory to `wellovue` fixes it permanently and also corrects the spelling of
"diabetis". To add a dependency, resolve the lockfile from a space-free path
(copy the manifests to `/tmp`, `npm install --package-lock-only` there, copy
`package-lock.json` back, then `npm ci`).

**Editing an applied migration used to brick the runner.** A checksum is
recorded when a migration runs, and any later change made `db:migrate` exit 1 —
including correcting a comment, so the pressure was to leave documentation
wrong rather than touch the file. The runner now records a second checksum over
the SQL with comments and whitespace stripped: a prose fix re-records itself
and says so, a statement change still refuses. Rows written before that
backfill automatically. `npm run db:repair` is the escape hatch for a file
already edited before any of this existed; it verifies nothing, because the
original contents are gone, and says so.

**A BEFORE trigger fires ahead of check constraints.** Migration 0018's
invariant was written as BEFORE and started answering for rows the 0006
constraints were going to refuse anyway — so an active blocked experiment was
rejected for having no prediction rather than for being blocked, and those
constraints stopped being exercised by anything. It is AFTER for that reason.

**`instanceof` fails across the package boundary.** The backend and
`@wellovue/types` can resolve different module instances of zod, so
`err instanceof ZodError` is false for a genuine ZodError. `ZodExceptionFilter`
detects structurally instead.

**OKLCH tokens cannot use Tailwind's `<alpha-value>`.** That substitution only
works with space-separated RGB triplets. Use `color-mix(in oklch, ...)`.

**SVG dash animation needs screen-space length.** `getTotalLength()` returns
user units while `vector-effect: non-scaling-stroke` makes `stroke-dasharray`
screen units. `DayTrace` sums the length per segment against the measured box.

**Vitest cannot emit decorator metadata.** esbuild does not support it, so
NestJS DI resolves every constructor parameter as `undefined`.
`backend/vitest-swc-plugin.ts` is a twenty-line inline SWC transform that fixes
it.

**Contrast must be measured through a canvas.** `getComputedStyle().color`
returns `oklch(...)` strings; naive parsing turns them into nonsense and
reports everything as passing.

**Lab test names arrive in whatever casing the source used.** The seeder writes
`HbA1c`; the contract's enum says `hba1c`. Detectors match case-insensitively —
an exact match told a record holding eight results that it had none. Units come
from the data too: HbA1c is reported in `%` and in `mmol/mol`, and a series
recorded in both is refused rather than trended.

**A started experiment cannot be deleted.** Its prediction cascades from it and
refuses to go while the account exists. Deliberate — removing the record of
what was expected by deleting the thing it was about is the loophole that makes
every accuracy figure optional. Erasing the account still works.

---

## 9. Infrastructure

| | Where | Notes |
|---|---|---|
| PostgreSQL 17.11 | `10.10.5.185:5432` | TimescaleDB 2.29.2, pgvector 0.8.6, pgcrypto. 11 domain schemas, 30 tables, 18 migrations. Four guard triggers: `audit_events_append_only`, `predictions_immutable`, `diabetes_safety_flags_append_only`, `experiments_active_requires_prediction` |
| MinIO | `10.10.5.240:9000` | Bucket `medicaldata`, scoped service account |
| Redis | local Docker | queues and cache, **not yet used in anger** |

Both VMs are Ubuntu 26.04, SSH user `support`, passwordless sudo. **Credentials
are not in this repo.** They live in the root `.env`, which is gitignored;
`.env.example` is the template.

**Network trap.** The VMs are on `10.10.0.0/16` but a developer machine arrives
over VPN from `192.168.3.0/24`. Firewall and `pg_hba.conf` rules need both
ranges or a perfectly healthy database will still refuse your connection.

**Latency from a developer machine is VPN, not slow queries.** Measured against
the VM: connecting costs ~700ms of TCP and TLS handshake, a warm round trip is
~55ms, and the login lookup everything once pointed at executes in 0.048ms
behind a correct index. Acquisition and execution are timed and reported
separately for that reason, and both thresholds are configurable — a warning
nobody can act on is how people learn to stop reading warnings.

**Not renamed with the product.** The database is still `diabetes`, the roles
`diabetes_app` / `diabetes_readonly`, and the S3 prefix `diabetes-platform/`.
These have data attached and are invisible to users. Roughly ten minutes of
work if wanted.

---

## 10. Go-live blockers

Neither is code, and neither has moved.

**PostgreSQL TLS is encrypted but unverified.** The VM presents a self-signed
certificate. The backend warns about it on every boot;
`REQUIRE_VERIFIED_DB_TLS=true` turns that into a refusal to start once a
CA-signed certificate is in place. `npm run db:verify-tls` reports the real
state and exits non-zero.

It also names a blocker nothing else had: `DATABASE_URL` connects to the bare
address `10.10.5.185`, and **no certificate can satisfy `verify-full` against
an IP literal** — there is no name to check it against and SNI cannot carry
one. The host needs a DNS name before the certificate is worth buying. Full
sequence in `infra/README.md`.

**Rate limiting is per process and cannot see real client addresses.** The
throttler counts in memory, so N replicas mean N independent budgets. Redis is
in the compose file and unused; `@nest-lab/throttler-storage-redis` is the
change to make before scaling out.

Separately, every browser request reaches the backend through the frontend's
`/api` proxy, which cannot see the caller's socket address and deliberately
strips the forwarding headers the caller sent, since it has no way to tell a
real one from a forged one. Address-keyed limits are therefore per-proxy. The
per-account limit on sign-in works today either way. Put a real reverse proxy
in front, have it overwrite `X-Forwarded-For`, then set `TRUST_PROXY=true`.

---

## 11. Open decisions

| Decision | Current state |
|---|---|
| Legal review of Privacy and Terms | **Required before launch.** Five placeholders: `[LEGAL ENTITY]`, `[JURISDICTION]`, `[HOSTING PROVIDER]`, `[EMAIL PROVIDER]`, `[LIABILITY CAP]` |
| Clinical review | **Required before gestational or Type 1.** Also before anything that could read as clinical decision support |
| Regulatory review | Not started. The prediction/outcome loop is the part most likely to attract it |
| Embedding dimension | `vector(1536)` is a placeholder. Fix before the first production migration; changing it later rewrites the table |
| Auth provider | Local JWT. Credentials are isolated in `identity.credentials`, so moving to OIDC means dropping one table |
| Hosting and deployment | **None assumed.** There is CI and no CD. Everything is containerised and environment-driven; nothing decides where it runs |
| Shared VM and MinIO credentials | Rotated by the infrastructure owner. The old commit is still reachable by SHA, so the rotation is what made those values worthless |
| Contact messages | Land in `support.contact_messages` with **no notification**. Somebody has to look, or it needs wiring to email |

---

## 12. Where to pick up

`docs/diabetes-wide-platform.md` § **Next Implementation Ticket** is kept
current and is the answer to "what now". At this commit it is:

> **Ticket 4: measure the result.** The outcome endpoint exists and scores
> observed against expected. What is missing is completing the experiment
> alongside it, and the screen showing predicted against observed.

That screen is the first place a person sees whether the platform was right
about them, which makes it worth designing carefully rather than quickly. It is
also the natural home for the missing "start an experiment" action, since
starting one is irreversible and should arrive with the screen that shows what
follows.

Then Ticket 5, the clinician packet. Then the go-live blockers in §10, neither
of which is code.
