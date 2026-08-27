# Handover

State of Wellovue as of 27 August 2026, at commit `dd89492`.

Read this before changing anything. Several decisions below look arbitrary and
are not, and a few traps in this repo will cost you an hour if you meet them
cold.

---

## 1. What this is

A causal Type 2 diabetes platform. Most diabetes tools record what happened;
this one is built to work out what is likely true for one person's body, how
confident anyone should be about it, and what safe next observation would
reduce the uncertainty.

> The product primitive is not "log glucose". It is: turn everyday diabetes
> data into personal, testable metabolic evidence.

`docs/` holds the original spec (thesis, architecture, data model, roadmap).
`PRODUCT.md` holds the design context: users, voice, anti-references.

## 2. Layout

```
frontend/           Next.js 15 · React 19 · Tailwind · TanStack Query
backend/            NestJS 11 core API
metabolic-engine/   Python 3.12 · FastAPI — pattern detection
packages/types/     @wellovue/types — Zod schemas shared by all three
infra/              migrations, provisioning, Docker
scripts/            migration runner, demo seeder, VM provisioning
```

The split follows one rule: **NestJS owns application state and workflows; the
Python engine owns scientific computation.** Neither reaches into the other.

## 3. Infrastructure

| | Where | Notes |
|---|---|---|
| PostgreSQL 17.11 | `10.10.5.185:5432` | TimescaleDB 2.29.2, pgvector 0.8.6, pgcrypto |
| MinIO | `10.10.5.240:9000` | Bucket `medicaldata`, scoped service account |
| Redis | local Docker | queues and cache, not yet used in anger |

Both VMs are Ubuntu 26.04, SSH user `support`, passwordless sudo. **Credentials
are not in this repo.** They live in the root `.env`, which is gitignored;
`.env.example` is the template.

**Network trap.** The VMs are on `10.10.0.0/16` but a developer machine arrives
over VPN from `192.168.3.0/24`. Firewall and `pg_hba.conf` rules need both
ranges or a perfectly healthy database will still refuse your connection.

**Not renamed with the product.** The database is still `diabetes`, the roles
`diabetes_app` / `diabetes_readonly`, and the S3 prefix `diabetes-platform/`.
These have data attached and are invisible to users, so renaming them is a
separate decision. Roughly ten minutes of work if wanted.

## 4. Running it

```bash
npm ci                    # NOT npm install — see the trap below
npm run db:migrate
npm run dev:backend       # :4000
npm run dev:frontend      # :3000
```

Or the whole thing in containers:

```bash
npm run docker:up         # frontend :3000, backend :4000, engine :8000, redis
npm run docker:down
```

Demo account: `node --env-file=.env scripts/seed-demo.mjs` seeds 60 days for
`demo.patient@wellovue.local` / `demo-patient-password`. The data encodes a
known ground truth (walking after a meal blunts the rise by 1.3 mmol/L) so the
pattern engine can be checked against an answer we control.

## 5. Tests

```bash
npm test                  # 30 unit, no infrastructure needed
npm run test:docker       # everything, in a throwaway stack
```

`test:docker` brings up its own PostgreSQL, MinIO and metabolic engine,
migrates, runs every suite, and tears down. Nothing touches the provisioned VMs. The Postgres image
carries the same extension versions as production, so hypertables, vector
indexes and the guard triggers are exercised for real.

| Suite | Count | Needs infra |
|---|---|---|
| `backend/test/*.spec.ts` | 30 | no |
| `backend/test/integration/schema-guards.spec.ts` | 18 | yes |
| `backend/test/integration/api.spec.ts` | 57 | yes |
| `metabolic-engine/tests` | 7 | no |

To iterate from an editor: `npm run test:stack:up` then
`npm run test:integration`. **Wait for the migrate container to finish** before
running, or the first run will fail confusingly.

The engine's Docker test stage also runs `ruff` and strict `mypy`, because a
type checker nobody enforces drifts within a week.

---

## 6. Traps in this repo

These have all cost time once already.

**Editing an applied migration used to brick the runner.** A checksum is
recorded when a migration runs, and any later change to the file made
`db:migrate` exit 1 — including correcting a comment, which meant the pressure
was to leave documentation wrong rather than touch the file. The runner now
records a second checksum over the SQL with comments and whitespace stripped, so
a prose fix re-records itself and a statement change still refuses. Rows written
before that are backfilled automatically, since a matching raw checksum proves
the file is byte-identical to what ran. `npm run db:repair` is the escape hatch
for a file already edited before any of this existed; it verifies nothing,
because the original contents are gone, and says so.

**`npm install` is broken here.** The directory name contains a space, and npm
11.6.2 silently produces an incomplete dependency tree under such a path: 526
packages instead of 767, with packages missing their own dependencies. It
surfaces much later as `Cannot find module 'vary'`. `package-lock.json` is
generated from a space-free path and committed. **Use `npm ci`.** Renaming the
directory to `wellovue` fixes it permanently and also corrects the spelling of
"diabetis".

**`instanceof` fails across the package boundary.** The backend and
`@wellovue/types` can resolve different module instances of zod (one ESM, one
CJS), so `err instanceof ZodError` is false for a genuine ZodError. An
exception filter written that way silently never fires. `ZodExceptionFilter`
detects structurally instead.

**OKLCH tokens cannot use Tailwind's `<alpha-value>`.** That substitution only
works with space-separated RGB triplets. The six places that relied on it use
`color-mix(in oklch, ...)` instead, and one more uses it to mix a tone toward
the paper. If you add a translucent colour, do the same.

**SVG dash animation needs screen-space length.** `getTotalLength()` returns
user units while `vector-effect: non-scaling-stroke` makes `stroke-dasharray`
screen units. Mixing them chops the trace into segments that read like gaps in
the data. `DayTrace` sums the length per segment against the measured box.

**Vitest cannot emit decorator metadata.** esbuild does not support it, so
NestJS DI resolves every constructor parameter as `undefined`.
`backend/vitest-swc-plugin.ts` is a twenty-line inline SWC transform that
fixes it. It replaced `unplugin-swc`, whose own dependency tree would not
install reliably.

**Contrast must be measured through a canvas.** `getComputedStyle().color`
returns `oklch(...)` strings; naive parsing turns them into nonsense and
reports everything as passing. Spot-checking also missed eight real failures
that a full text-node sweep caught.

---

## 7. Decisions that should not be casually undone

**The database enforces the safety rules, not the application.** Predictions
are immutable and undeletable, the audit trail is append-only, a
clinician-gated experiment cannot be marked active without review, and a
blocked one can never run. All triggers and check constraints, all tested by
attacking them directly over SQL in `schema-guards.spec.ts`.

**Erasure unlinks identity; it does not delete history.** Migration `0010`
permits exactly one kind of update to `audit.events`: clearing the actor and
subject. Everything else, including reassignment, is refused. This is what lets
GDPR erasure coexist with an audit trail worth having.

**Writes and their audit entries are atomic.** Every health-data write commits
in one transaction with the audit row describing it, and a failed audit write
throws. `recordBestEffort` exists for the rare deliberate exception and is
named so you can grep for it.

**No credential is readable by page JavaScript.** The refresh token is in an
HttpOnly, SameSite=Strict cookie scoped to `/api/auth`; the access token lives
in memory for the tab. There is a second cookie, `wellovue_signed_in`, holding
the character `1` — it grants nothing, the server never trusts it, and two
tests assert that presenting it alone returns 401. It exists so a public page
can offer a signed-in visitor their timeline instead of a login form without
costing an API call per anonymous visitor.

**A finding comes from a model, never from a language model.** An LLM may
phrase a finding that exists; it must not create one. Every finding carries an
effect estimate, confidence, sample count and explicit limitations. When data
is thin the answer is "not enough data" plus what to log. Do not soften this.

**The evidence endpoint is never told whose data to read.** The Python engine
will answer about any user id it is handed, so `GET /api/evidence` accepts only
a time range and takes the identity from the verified access token. That is the
whole authorisation decision, made in one place in `EvidenceService`. Adding a
`userId` parameter for convenience would turn an authenticated endpoint into a
lookup of anyone's metabolic record.

**A finding with no effect estimate is shown, not hidden.** The engine returns
those when a comparison group is too thin, and the Evidence screen groups them
under "Not enough data yet" with what each one needs. Dropping them would make
the screen look more certain than the data is. They are also scored
`insufficient` by `findingStrength()` regardless of sample count — the count
describes what was logged, not what was measured, so `evidenceStrength()` alone
would badge them "weak evidence" and claim a measurement nobody made.

**Colour is reserved for meaning.** One palette across both surfaces: warm
paper, warm ink, and colour only for glucose relative to target and for
evidence strength. No teal or blue anywhere, deliberately, because that is the
healthcare default this product is trying not to be. `-text` variants of each
semantic colour exist because a coloured glyph beside a sentence is text and
must clear 4.5:1, while a filled shape only needs 3:1.

**The app shares the landing page's language, not its density.** A dashboard is
scanned; a landing page is read. Same palette, typeface and semantics;
different scale steps and rhythm.

**Atkinson Hyperlegible is a functional choice.** The Braille Institute drew it
for low vision, and retinopathy is a complication of the condition this serves.
The mono cut is reserved for measured values.

---

## 8. What is built

- Monorepo, shared contract package, Docker for both running and testing
- PostgreSQL with 11 domain schemas, 28 tables, 12 migrations
- Auth: argon2id, JWT access token, rotating single-use refresh token
- Audit logging and consent tables
- Glucose entry, CSV import from CGM/meter exports, meal logging with photos,
  medication records, activity events
- The unified metabolic timeline
- Pattern engine v1 producing structured findings
- The Evidence screen, reading live findings through `GET /api/evidence`
- Diabetes care profile, with every unsupported care mode refused twice
- Prediabetes evidence, and lab/body-measurement capture behind it
- Experiment safety, enforced in the request path and by database constraints
- Public site: landing, About, How this works, Contact, Privacy, Terms, Cookies
- Waitlist and contact endpoints, both public, validated, audited
- Rate limiting on every public endpoint, keyed on address and, for sign-in,
  on the target account as well
- GitHub Actions CI: types, lint, unit tests, frontend build, and the full
  Docker integration stack

## 9. What is not

- Prediction accountability API. Tables and immutability guards exist; no
  endpoints.
- **Deployment.** There is CI but no CD, and no hosting is assumed. Everything
  is containerised and environment-driven; nothing decides where it runs.
- Future Sandbox, Living Trials, Clinician Evidence Room.
- Mobile app.
- Contact messages land in `support.contact_messages` with **no notification**.
  Somebody has to look, or it needs wiring to email.

## 10. Open decisions

| Decision | Current state |
|---|---|
| Legal review of Privacy and Terms | **Required before launch.** Five placeholders: `[LEGAL ENTITY]`, `[JURISDICTION]`, `[HOSTING PROVIDER]`, `[EMAIL PROVIDER]`, `[LIABILITY CAP]` |
| PostgreSQL TLS | Encrypted but unverified (VM's self-signed cert). Warned about on every boot; `REQUIRE_VERIFIED_DB_TLS=true` turns the warning into a refusal to start. Full sequence in `infra/README.md` |
| Shared VM and MinIO root credentials | Appeared in early git history and have since been **rotated** by the infrastructure owner. GitHub still serves the old commit by SHA, so the rotation is what makes the values worthless; purging unreachable objects is tidying, not remediation |
| Embedding dimension | `vector(1536)` is a placeholder. Fix before the first production migration; changing it later rewrites the table |
| Auth provider | Local JWT. Credentials are isolated in `identity.credentials`, so moving to OIDC means dropping one table |
| Infra names | Database, roles and S3 prefix still carry the old product name |
| Hosting | None assumed. Everything is containerised and environment-driven |

## 11. Where things live

| | |
|---|---|
| Design context, voice, anti-references | `PRODUCT.md` |
| Infrastructure, guarantees, security posture | `infra/README.md` |
| Original product spec | `docs/` |
| Setup, checks, design decisions | `README.md` |
