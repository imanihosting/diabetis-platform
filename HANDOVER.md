# Handover

State of Wellovue as of 27 August 2026, at commit `6cccc0a` plus launch hardening.

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
| Design system: surfaces, space, width, type, controls | `DESIGN.md` |
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
read. All seven steps exist. What is left is not the loop.

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
- Predictions: immutable, server-generated, attributed to an engine version,
  one per experiment
- Starting an experiment, with its prediction written in the same transaction
- Finishing one by recording what happened, in one transaction, scored against
  the expectation — and the screen showing predicted beside observed
- Outcomes: written once, never edited, and the only way to complete a trial
- The clinician packet: thirty or ninety days on one page — findings with their
  limitations, glucose, lab trends, every experiment with the expectation
  recorded before it ran, and what is worth raising
- Rate limiting on public endpoints; CI on every push
- Public site: landing, About, How this works, Contact, and the policy pages

**Not built.** Named plainly on the public pages too, which matters — see §7.

- Weighing competing explanations for a pattern. Step four of the loop, and the
  only one still labelled "Being built"
- Exporting the packet. It is a web page and nothing else: no PDF, no print
  stylesheet beyond dropping the app chrome, no share link. Deliberate — the
  page had to be right before the format question was worth asking
- Recording a clinician's agreement. A gated experiment therefore waits
  forever, and says so rather than implying a queue
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
npm test                  # 78 unit, no infrastructure needed
npm run test:docker       # everything, in a throwaway stack
```

`test:docker` brings up its own PostgreSQL, MinIO and metabolic engine,
migrates, runs every suite, and tears down. Nothing touches the provisioned
VMs. The Postgres image carries the same extension versions as production, so
hypertables, vector indexes and the guard triggers are exercised for real.

| Suite | Count | Needs infra |
|---|---|---|
| `backend/test/*.spec.ts` | 78 | no |
| `backend/test/integration/api.spec.ts` | 58 | yes |
| `backend/test/integration/reports.spec.ts` | 13 | yes |
| `backend/test/integration/experiments.spec.ts` | 28 | yes |
| `backend/test/integration/schema-guards.spec.ts` | 25 | yes |
| `backend/test/integration/predictions.spec.ts` | 19 | yes |
| `backend/test/integration/diabetes-profile.spec.ts` | 14 | yes |
| `backend/test/integration/labs-prediabetes.spec.ts` | 9 | yes |
| `backend/test/integration/engine-gate.spec.ts` | 7 | yes |
| `backend/test/integration/throttle.spec.ts` | 7 | yes |
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
are immutable, outcomes are written once and never edited, the audit trail is
append-only, safety flags cannot be rewritten, a clinician-gated experiment
cannot skip review, a blocked one can never run, an experiment cannot become
active without a prediction attached to it, and it cannot become completed
without an outcome recorded against that prediction. All triggers and check
constraints, all tested by attacking them directly over SQL.

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

**One door in for each half of the record.** A prediction is written only by
starting an experiment; an outcome only by completing one. The standalone
endpoints for both were removed in Ticket 4 because each produced a state
nothing could resolve — an expectation attached to a trial that never ran and
so can never be measured, and a measurement that leaves its trial running with
the answer already known. One experiment has exactly one prediction, by unique
index.

**The engine names findings; the contract titles them.** `findingType` is the
record's identifier and belongs in the record — a clinician quotes it and the
packet keys on it — but it is not a heading, and `late_evening_meal_response`
told a person with diabetes nothing. `findingPresentation()` in the shared
contract supplies a title and a diabetes lens for each. It is a display name
for an enum, in the same category as `careModeLabel`, and it must never be
where a new claim is introduced: anything that interprets somebody's data
belongs in the engine, behind the review that gets it there. That line is the
whole reason the map is a lookup and not a sentence generator.

**A finding carries the glucose it compared, not only the difference.**
Detectors used to compute baselines, peaks and group sizes and then throw them
away, keeping one number — which is why the interface could only ever render a
sentence with one number in it. `comparison` on `StructuredFinding` carries the
groups as absolute mmol/L, so a finding can be drawn against the target band. A
difference of 1.1 says nothing about whether either group ended up in range;
the band says it immediately. Findings that are not glucose comparisons, like
lab trends, carry an empty list and draw no chart.

**A p-value is a statistic, not a limitation.** It used to be a sentence inside
`limitations`, which made the evidence screen read as a lab report. It has its
own field and sits behind a disclosure.

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
evidence strength. Predicted and observed are therefore shown in the same ink,
uncoloured: a green number for "we were right" would be a third meaning
invented to flatter the platform, and for half of all findings a lower number
is not an improvement anyway. No teal or blue anywhere, deliberately. `-text` variants
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

One of the seven loop steps on `/how-it-works` is still marked **"Being
built"**: weighing competing explanations against each other. Everything else
on the public pages describes something that exists. The landing page's finding
quotes the strings the engine actually emits.

Two labels have come off, each when the thing it covered started existing: the
proposed-trial panel in Ticket 4, the clinician summary in Ticket 5. That is
the only reason a label should ever come off. Both panels are typeset
illustrations of real screens rather than screenshots of them, and their
figures are the demo record's own.

**Which kinds of diabetes the public pages claim to serve is computed, not
written.** `CareCoverage` calls `careModeCapabilities` — the same function the
API calls before deciding whether to ask the engine anything — and prints the
engine's own refusal sentence for every care mode without reviewed detectors.
The landing page and the white paper both use it. Add a reviewed Type 1
detector and put the mode in `EVIDENCE_READY`, and both pages change
themselves; there is no marketing copy to remember to update, which is the kind
of promise that otherwise rots into a lie.

The distinction it draws is the one to keep straight, because it is easy to get
wrong in both directions. The record is diabetes-wide **today**: every type
representable, timeline, ingestion, labs, medication, the safety classifier
across every care mode, audit, erasure and the clinician summary. Interpretation
is Type 2 and prediabetes only — the engine has four detectors for each Type 2
mode, five for prediabetes, and zero for Type 1, gestational and
other-specific. Calling this a Type 2 product hides most of what is built;
calling it diabetes-wide without qualification sends somebody with Type 1 to a
screen that refuses them, having promised otherwise.

`/white-paper` is the page this rule matters most on, because it is written for
readers evaluating the platform and it quotes specific numbers: 78 unit tests,
180 integration, 29 engine, nineteen migrations, six guard triggers, eleven
domain schemas, and the demo engine recovering about -1.05 against a seeded
-1.3. Every one of those was checked against the repository and the live
database when it was written; check them again before changing them. It embeds
the same `LoopSteps` component as `/how-it-works`, so the build labels cannot
drift between the two. It deliberately carries no market sizing, revenue model,
user count or funding ask, and says so on the page — those would be the only
unverifiable claims on the site.

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

**A read inside a transaction needs that transaction's connection.**
`DatabaseService.queryOne` goes to the pool and will hand back a different
connection, which cannot see uncommitted writes. `PredictionsService.forExperiment`
takes an optional `PoolClient` for exactly this reason, the same way
`audit.record` does — completing an experiment reads the prediction back to
report the `matched` status it has just written.

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

**Open: the integration suite misroutes about one run in eight.** A test
fails with a status no guard or handler in this application ever issued —
usually a 401 where 200 was expected, sometimes a 404 on a route that exists —
and the failing test moves between files from run to run. Roughly 1 in 8 full
runs; a single file run alone has never reproduced it.

What has been ruled out, each by instrumenting the source and looping the suite
until it failed again:

- **Not JWT verification.** `JwtAuthGuard` logs nothing when these 401s are
  returned. Neither branch fires: the header is present, and `verifyAsync` does
  not throw. Whatever answered did not come through this guard.
- **Not token expiry.** `JWT_ACCESS_TTL` is 15 minutes; a full run takes about
  fifteen seconds.
- **Not credentials.** `AuthService.login` logs only the failures the suite
  causes deliberately.
- **Not HTTP keep-alive.** Node 19 turned `http.globalAgent.keepAlive` on by
  default, which is a real hazard here — every spec file builds its own app,
  supertest binds it to an ephemeral port, `afterAll` closes it, and a later
  file can be handed the same port while pooled sockets still point at it.
  Setting `keepAlive = false` for the suite did not stop the failures.

The strongest remaining signal: the wrong statuses are exactly the ones *other*
tests deliberately produce — 401 from the unauthenticated assertions, 404 from
the "this route does not exist" assertions. A response arriving from the wrong
server instance fits every observation, including the timing (2ms for a call
that reaches the pattern engine and cannot return in under 50ms).

So this looks like the harness misrouting a request rather than anything wrong
in the product, which is why it is not treated as a release blocker. It should
still be fixed: it will eventually fail CI on a change that is perfectly fine,
and the first instinct will be to go looking for an auth bug that is not there.
Next thing to try is proving which server answered — bind each file's app once
with an explicit `app.listen(0)` and stamp the port on every response.

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
| PostgreSQL 17.11 | `10.10.5.185:5432` | TimescaleDB 2.29.2, pgvector 0.8.6, pgcrypto. 11 domain schemas, 30 tables, 19 migrations. TLS verified against an internal CA. Six guard triggers: `audit_events_append_only`, `predictions_immutable`, `prediction_outcomes_immutable`, `diabetes_safety_flags_append_only`, `experiments_active_requires_prediction`, `experiments_completed_requires_outcome` |
| MinIO | `10.10.5.240:9000` | Bucket `medicaldata`, scoped service account |
| Redis | local Docker | queues and cache, **not yet used in anger** |

Both VMs are Ubuntu 26.04, SSH user `support`. Sudo needs the password — the
earlier claim of passwordless sudo was wrong. **Credentials are not in this
repo.** They live in the root `.env` and in `docs/database-vm.md`, both
gitignored; `.env.example` is the template. `docs/database-vm.md` was tracked
until its ignore rule was made effective, so check `git ls-files` before
trusting a `.gitignore` entry for a file that already existed.

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

**PostgreSQL TLS is verified.** Done. An internal CA on the database VM signs a
certificate for `medical-db`, valid to 2031; the CA certificate is committed at
`infra/db/ca.crt` because a trust anchor is public, not secret. Every client
checks it, `REQUIRE_VERIFIED_DB_TLS=true`, and a regression refuses to boot
rather than downgrading quietly. `scripts/issue-db-cert.sh` reproduces it.

An internal CA rather than Let's Encrypt because every client is ours: public
trust buys nothing on a private network, and its costs are real — a third party
in the trust path of a health record, a token on the database host, and a
ninety-day renewal whose failure looks exactly like success until it expires.

The trap worth knowing, because it is a property of the driver and not of
certificates: **node-postgres tells Node which host to verify only when the host
is not an IP address** (`pg/lib/connection.js`). Connect to `10.10.5.185` and
Node checks the certificate against `localhost` and refuses, whatever SANs it
carries. So clients connect by name, which has to resolve — `extra_hosts` in
compose, and on a developer machine:

```bash
echo "10.10.5.185 medical-db" | sudo tee -a /etc/hosts
```

Without that line `npm run db:migrate` and `npm run db:verify-tls` cannot
resolve the host at all. The containers carry their own mapping and are
unaffected.

**Rate limiting is now shared, and half-keyed.** Counts live in Redis when
`REDIS_URL` is set, so replicas share one budget;
`REQUIRE_SHARED_RATE_LIMIT=true` refuses to start without it, which is the
switch to flip when a second replica appears. When Redis is configured and then
stops answering, counts fall back to the process rather than failing open or
closed — verified against the running stack: with Redis stopped the tenth
failed sign-in still returns 429, one line is logged rather than one per
request, and recovery announces itself.

What is still missing is the key, not the count. Every browser request reaches
the backend through the frontend's `/api` proxy, which cannot see the caller's
socket address and strips the forwarding headers it was sent, since it cannot
tell a real one from a forged one. Address-keyed limits are therefore per
proxy. The per-account limit on sign-in works today either way. Put a real
reverse proxy in front, have it overwrite `X-Forwarded-For`, then set
`TRUST_PROXY=true`.

**Legal placeholders are still in the pages, on purpose, and now cannot ship.**
`node scripts/check-launch-blockers.mjs` fails while any of the five remain,
and `.github/workflows/release-gate.yml` runs it on a version tag. It is not on
every push deliberately: it fails today, and a permanently red CI is one nobody
reads, which would cost the ordinary checks their meaning to protect a launch
nobody has scheduled. Filling the blanks in is not the same as legal review.

**Checking a deployment.** `npm run canary -- <base-url>` reports whether
something should carry traffic, entirely over HTTP — no shell on the host, no
container environment. Health failures (process, database, object storage) fail
it anywhere; posture failures (verified TLS, shared limits) are warnings unless
`--require-production`, because both are states the platform runs in on purpose
and a gate that goes red for the shipped configuration gets switched off.
`/api/health/posture` is what it reads.

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
current and is the answer to "what now". The loop is closed, so what is left is
no longer a ticket in that sequence — it is a choice between four things, and
the order is a judgement somebody should make deliberately rather than by
picking up whatever is nearest:

1. **The rest of the go-live blockers in §10.** The code side is done: rate
   limits are shared, both unsafe states refuse to start behind a flag, a
   canary checks a deployment from outside, and the legal placeholders cannot
   ship. What is left is not code — a DNS name for the database host, a
   certificate for it, a reverse proxy that sets `X-Forwarded-For`, and the
   five legal facts plus a lawyer to read the result. The DNS name is the only
   item with a lead time, and it blocks the certificate.
2. **Exporting the packet.** It is a web page and nothing else. A printed sheet
   is what actually gets carried into an appointment, and the page was built
   for a printer without anybody testing it against one.
3. **Weighing competing explanations.** The last loop step still labelled
   "Being built" on the public pages, and the one that would change what the
   engine says rather than how it is presented.
4. **Recording a clinician's agreement.** Until this exists, every
   clinician-gated experiment waits forever, and the product says so in as many
   words. That is honest but it is not finished.

Gestational and Type 1 stay parked behind clinical review either way, and
per-user target ranges still wait on something ready to honour them.

One caution before touching the public pages: see §7. Two "Being built" labels
have come off so far, each when the thing it covered started existing, and that
is the only reason one should.
