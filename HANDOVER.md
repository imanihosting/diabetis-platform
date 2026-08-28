# Handover

State of Wellovue as of 28 August 2026, at commit `71964d7`, which is also
`origin/main` — nothing is unpushed.

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
- Findings carry the glucose they compared: mean response curves against the
  target band, human titles and a diabetes lens, p-value behind a disclosure
- Hour-of-day findings read the account's timezone, and CSV imports parse
  offset-less device times in it
- Rate limiting shared across replicas in Redis; database TLS verified against
  an internal CA; a canary that checks a deployment over HTTP; CI on every push
- Public site: landing, About, How this works, White paper, Contact, and the
  policy pages
- A locked design system in `DESIGN.md`, applied: surfaces rather than bordered
  boxes, product-width app shell, one control vocabulary, and an icon

**Not built.** Named plainly on the public pages too, which matters — see §7.

- Weighing competing explanations for a pattern. Step four of the loop, and the
  only thing still labelled "Being built" anywhere on the public pages. Nothing
  implements it: `experiments.hypotheses` has existed since migration 0006 and
  nothing has ever inserted a row
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
npm test                  # 292 unit, no infrastructure needed
npm run test:docker       # everything, in a throwaway stack
```

`test:docker` brings up its own PostgreSQL, MinIO and metabolic engine,
migrates, runs every suite, and tears down. Nothing touches the provisioned
VMs. The Postgres image carries the same extension versions as production, so
hypertables, vector indexes and the guard triggers are exercised for real.

| Suite | Count | Needs infra |
|---|---|---|
| `backend/test/*.spec.ts` | 139 | no |
| `backend/test/integration/api.spec.ts` | 58 | yes |
| `backend/test/integration/reports.spec.ts` | 13 | yes |
| `backend/test/integration/experiments.spec.ts` | 28 | yes |
| `backend/test/integration/schema-guards.spec.ts` | 25 | yes |
| `backend/test/integration/predictions.spec.ts` | 19 | yes |
| `backend/test/integration/diabetes-profile.spec.ts` | 18 | yes |
| `backend/test/integration/labs-prediabetes.spec.ts` | 9 | yes |
| `backend/test/integration/engine-gate.spec.ts` | 7 | yes |
| `backend/test/integration/throttle.spec.ts` | 7 | yes |
| `frontend/test/*.spec.ts(x)` | 156 | no |
| `metabolic-engine/tests` | 104 | no |

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
- **`post-meal-metrics.spec.ts`** does the same job for `PostMealMetrics`,
  which exists in both languages for the same reason. It reads the field
  aliases out of `findings.py` and the shape words out of `post_meal.py` and
  fails if either side has grown something the other has not heard of. That
  drift is silent otherwise: zod strips a key it does not recognise, so an
  engine field the contract has never seen throws nowhere and simply never
  reaches the screen.
- **`frontend/test/test-counts.spec.ts`** is the guard on the white paper's
  own claims; see §7.
- **`frontend/test/post-meal-labels.spec.tsx`** proves the evidence page and the
  clinician packet name the post-meal measurements identically, by rendering one
  and reading the source of the other. Neither may hard-code a label.
- **`frontend/test/seo.spec.tsx`** renders every public page to markup and
  asserts against the result rather than against page source. That is the whole
  reason it needs a renderer: no public page on this site contains an `<h1>`,
  because every one of them gets its heading from `PageHeader` or `LegalPage`,
  so grepping for the tag would prove nothing. `next/navigation` is stubbed in
  `frontend/test/stubs/` so a page renders outside a request.
- **`metabolic-engine/tests/test_post_meal.py`** is half arithmetic and half
  silence. Every expected value was worked out by hand from the curve in the
  test rather than read off the implementation, and most of the cases are about
  getting no answer rather than a number — because every way these can be wrong
  makes a meal look better than it was.

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

**An engine version means "the output changed", not "the code changed".**
`MODEL_VERSION` went to `pattern-engine-v1.1.0` when hour-of-day moved onto the
account's timezone, because that materially changes three findings. Every
prediction records the build that made it and the clinician packet reports it,
so a prediction made under the UTC reading and one made after are not answers
to the same question — giving them the same version would quietly claim they
were comparable. Bump it whenever a detector's output moves, not when a file
does.

`v1.2.0` is the additive case and shows what the minor digit is for: the
post-meal measurements added output without moving a single existing summary,
effect estimate, confidence or sample count. Still a version, because a packet
quoting `v1.1.0` was answering with strictly less about the same meals.

**An offset-less CSV timestamp is the person's wall clock.** Most CGM exports
write local time with no offset. Those used to be parsed by `new Date`, which
applies whatever zone the API process runs in — so an export from a phone in
Sydney into a UTC server shifted every reading by eleven hours, which then
moved meals across the late-meal boundary and in and out of the morning window.
The parser now takes the account's timezone, honours an explicit offset when
the export carries one, and **rejects an offset-less shape it does not
recognise** rather than handing it to `new Date`, which would always produce an
answer and silently reintroduce the same error.

**Hour-of-day findings read the person's clock, not the server's.** Every
timestamp reaches the engine as UTC, and three findings turn on hour-of-day:
the morning window, the fasting window, and the late-meal split at 20:00.
`identity.users.timezone` (migration 0020) travels with the profile context to
the engine, which converts every frame once in `detect_all` before any detector
reads an hour.

Measured on the demo record, which is the argument for why this mattered: the
same thirty days read as UTC give "late meals, 3.1 mmol/L larger rise, 10 late
vs 64 earlier", and read as Australia/Sydney give "0.2 mmol/L, 25 late vs 49
earlier". Not a less confident finding — a different one, about different
meals.

It was invisible in development because `scripts/seed-demo.mjs` authors meals
with `setUTCHours`, so the seeded ground truth and the detector agreed in UTC
and every demo finding looked right. The demo account is therefore genuinely
UTC and should stay that way.

Defaults to UTC rather than to the browser's guess. A guessed zone produces the
same wrong findings while looking like a decision somebody made; the care
profile shows the browser's value in a control the person can see and change.

An **omitted** zone defaults to UTC; an **unrecognised** one is refused with a
422. Those are different things, and only the first has a safe default. The
engine fails closed everywhere else — `careMode` defaults to `unknown`, which
no detector supports — and a zone it cannot resolve is an unrecognised input,
not an omission. Accepting it would return a confident finding computed on the
wrong clock.

**A finding carries the shape of the response, not only its endpoints.**
`post_meal_responses` keeps each meal's readings binned by minutes since the
meal, and `_group` averages them per bin across a group — dropping a bin fewer
than a third of the meals reached, so a thinning tail is not drawn as the
pattern. That is what lets the evidence charts be real glucose curves in the
timeline's own language rather than two abstract shapes.

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

## 6a. Post-Meal Intelligence v1

Shipped. Every meal comparison group now carries `postMeal`: time to peak,
minutes above target range, time back in range, area above target, the count of
meals still above when the window closed, and one word for the shape. Peak and
rise were already on the group and are not repeated. The engine is
`pattern-engine-v1.2.0`; nothing an earlier build reported has moved.

Where it lives: `metabolic-engine/app/engines/post_meal.py` computes it,
`_group()` in `patterns.py` attaches it, `PostMealMetrics` in `findings.py` and
in `packages/types/src/insights.ts` are the two halves of the contract, and
`frontend/src/components/PostMealMeasurements.tsx` renders it under the trace.

**Measured per meal, then averaged. Never off the mean curve.** This is the
decision the feature turns on. Peaks land at different times, so averaging the
curves first flattens them — a group whose meals routinely reached 11 mmol/L
can produce a mean curve that never crosses target at all, and the product
would report somebody as never having left range on the strength of it. The
error is not merely inaccurate, it is inaccurate in the direction that makes a
meal look better than it was. `test_averages_the_meals_rather_than_the_curves`
is the one holding this.

**A meal is measured only if it was watched.** Three curve points minimum, and
the last one at or past three quarters of the window. Below that the meal joins
the group's rise average and contributes nothing here, and `PostMealMetrics.n`
reports how many actually qualified — often fewer than the `n` on the badge,
which is why the table prints "18 of 22" rather than trusting the reader to
assume. A response that stopped at forty-five minutes reports a shorter time
above range and an earlier return than the same meal watched for two hours; the
bar exists so it reports nothing instead. The three-point floor is set just
below the classic fingerstick pattern — before, an hour, two hours — because
that person is exactly who these measurements are for.

**The window ending is not a return to range.** `returnToRangeMinutes` averages
only the meals that came back, and `stillAboveAtWindowEnd` counts the rest. Null
therefore means two different things, and the other fields separate them: with
`minutesAboveRange` at zero nothing went above target; above zero, nothing came
back in time. Folding the stragglers in as though the clock running out were a
return would bury the meals that most need to be visible.

**The shape thresholds are a first cut and have not had clinical review.** They
live in `thresholds.py` so they can be argued with as a set. `prolonged` is
anchored to half of `POST_MEAL_WINDOW_MINUTES` rather than picked, specifically
so it cannot drift toward whatever makes a given record read better. They decide
a word, never a refusal and never a number.

**The residual shape is `rose_and_returned`, not `typical`.** It was `typical`
until two groups were read side by side — one spending 56 minutes above target,
the other 11 — and both came back labelled typical. The word claims a normality
this engine has not computed and has no basis for: typical of whom? A residual
bucket has to be named for the measurements that put a response in it. The same
rule that keeps `findingPresentation` a lookup rather than a sentence generator.

**The packet carries these too, and both surfaces name them identically.**
v1.1 closed the split: the person reading their evidence page and the clinician
reading the packet were going to see the same finding at two different depths,
which is the worst possible version of a shared document.

The rows and their labels come from `postMealMeasurements()` in the shared
contract, not from either page. Only the layout is decided per surface — a
comparison table on the evidence page, because those findings are read across;
a definition list per group in the packet, because that page is laid out in a
narrow print column and a table would scroll or be cut. A test renders one and
greps the other, and fails if either hard-codes a label of its own.

`POST_MEAL_WINDOW_MINUTES` now exists in TypeScript as well, because "still
above at two hours" is that constant spelled out and a surface that hard-codes
the words while the engine moves the window is a surface that lies to a
clinician. `backend/test/post-meal-metrics.spec.ts` holds the two copies
together, the same way it does for the target range.

The window reads as words in a sentence and figures in a cell —
`postMealWindowLabel('words')` against the default. Same fact, two registers:
"the two hours ended" in prose, "Still above at 2 hours" in a table.

---

## 6b. CGM Coverage and Evidence Quality

Shipped. Every glucose finding now carries `dataQuality`, and coverage caps how
strong one may be called. Engine is `pattern-engine-v1.3.0`.

**The rule, in one sentence:** a finding must never look strong because there
are many readings, when those readings are clustered, incomplete, or missing
the window the finding is about. A sample count answers "how much was
recorded" and cannot answer "how much of the period was watched", and the two
come apart in the direction that flatters — a sensor worn hard for four days of
a month produces thousands of readings and describes an eighth of it.

**A ceiling, never a promotion.** `evidence_strength()` takes an optional
coverage and returns the weaker of the two answers. A complete record is a
precondition for trusting a result, not evidence for one, so perfect coverage
over four readings is still insufficient. Omitting coverage gives exactly the
answer the function gave before it existed, which is what every lab finding and
every hand-built test input gets.

**Nothing else moved.** No effect estimate, confidence, p-value or summary
changes. What changes is the word beside them, and only downward. The demo
record — dense CGM, meals every day — keeps all four findings at exactly the
strengths and estimates it had under v1.2.0; `test_a_complete_record_keeps_
every_word_it_had` runs each detector with and without a window and compares
the findings both ways, which is the before and after of shipping this.

**A finding is judged on the window it is about, and that is the whole design.**
Three bases, measured three different ways on purpose:

| Basis | Fraction of | Measured as |
|---|---|---|
| `POST_MEAL` | logged meals | meals whose response was watched long enough to time |
| `MORNING` | mornings in the period | mornings with a reading at all |
| `WHOLE_WINDOW` | the whole period | time within half a max-gap of a reading |

Whole-window coverage would fail every person who tests with a meter rather
than wearing a sensor — including the ones who test faithfully before and after
every meal, and who therefore have complete coverage of the only windows their
findings concern. A meter user testing four times a day covers 6% of a month
and 100% of their mornings, and both numbers are true.

The morning basis is presence, not continuity, because that is what the finding
is built from: a morning-glucose pattern takes one average per morning, so a
morning with a single waking reading is a morning it can use. Measuring
unbroken hours would mark down the exact record the detector was written for.

**The post-meal denominator is every meal logged, not every meal with a
response.** Those differ by the meals with no glucose near them at all, which
are the ones the figure most needs to count. A first cut divided by the meals
that produced a response and reported a record with two thirds of its meals
unwatched as complete; a test caught it. The numerator reuses
`measurable_responses()` from the post-meal work rather than reimplementing
"watched long enough", so a coverage figure cannot disagree with the
measurements printed beside it.

**These are product evidence thresholds, not clinical ones, and the
distinction is load-bearing.** A clinical threshold decides care: what a result
means for somebody and what should happen next. These decide one English word
on a card. No effect estimate, confidence, p-value or recommendation moves
because of them, which is why they ship without clinical review — and why the
moment one starts gating something a person might act on, it has stopped being
a product threshold and needs that review. Reviewable, not provisional: a
considered first cut, conservative on purpose, declared as a set in
`thresholds.py` beside the shape thresholds and mirrored in `insights.ts`.
`backend/test/post-meal-metrics.spec.ts` fails if the two disagree.

**Coverage and confidence stay separate, and the interface resolves it.**
They are different truths: confidence is how stable the relationship is inside
the data there is, coverage is how much of the period that data observed. A
record can be entirely consistent about the fortnight it watched and silent
about the fortnight it did not, and blending those into one number answers
neither question. So `evidenceBreakdown()` returns both plus the weaker as the
overall, and both surfaces show all three. A reader meeting a finding marked
weak can see which half was weak — the pattern, or the watching — and those
call for opposite responses: "this may not be real" against "wear the sensor
another fortnight".

The explaining sentence appears only when coverage is what held the finding
back. When the signal was the weaker half, blaming coverage would point the
reader at the wrong remedy.

**Care-mode gating, experiment safety and prediction immutability are
untouched.** Nothing in `registry.py`, the experiment tables or the prediction
path changed. Type 1 and gestational remain unsupported.

---

## 6c. Competing Explanations v1

Shipped, and it took the last **"Being built"** label off the public site.
Engine is `pattern-engine-v1.4.0`.

Every finding that measured something now carries the reviewed alternatives
that could produce the same pattern. A detector reporting "meals followed by a
walk were followed by a smaller rise" has found an association between two
groups a person created by living their life; those groups differ in more than
the walk, and reporting the association without naming that is how it gets read
as a cause.

**Nothing is generated.** `app/engines/explanations.py` is a catalogue,
reviewed as a set, in the same category as `suggestions.py` and for the same
reason: a competing explanation is a clinical claim about why somebody's
glucose did what it did, and a sentence assembled at request time is a claim
nobody approved. The frontend composes none of it — a test greps both surfaces
for clinical vocabulary and fails if either has started writing.

**Each entry answers four questions**, because naming an alternative is not
enough to use it: why it could produce this, what a record would look like if
it were true, what is missing from this one, and whether the product can
capture that.

**The capture field is a reference, not a boolean.** `capture` names a value
from `suggestions.py`, where every entry names the endpoint that stores it, and
a test asserts every non-null capture is one of them. A boolean would be
somebody's opinion at the time of writing and would stay true-looking long
after the capture path was removed. `None` means the product cannot record it —
sleep, illness, sensor sessions, which laboratory ran an assay — and the
explanation says so plainly rather than being dropped. "Nobody measured this"
is a real answer; asking somebody to log something with nowhere to put it sends
them looking for a control that does not exist.

**Attached in one place.** `_with_explanations` in `detect_all`, not in each
detector, because a detector that forgot would present an association as though
it had no alternatives and nothing about writing one reminds you. Only for
findings with an effect estimate: offering four alternatives for a result that
does not exist would read as though one did.

**Two tests are the whole enforcement**, and both were checked by breaking them
deliberately:

- every detector in the registry has catalogue entries or is named in
  `NO_EXPLANATIONS_NEEDED`, so a new detector cannot ship without somebody
  deciding which; and
- every `capture` is something the product actually records.

**`building` stayed in `LoopSteps`** after the last label came off. Deleting
the mechanism is how a product ends up with no way to say "not yet" at the
moment it most needs one. Put it back before describing something unbuilt.

---

## 6d. The packet on paper

Shipped. `/report` prints as a clinical handover document rather than as a web
page that happens to survive a printer.

**Print-first, not PDF-first.** Every browser and operating system already
knows how to print, to save as PDF, and to send to a printer down the
corridor. A bespoke PDF export would be a second rendering path to keep in step
with the first, and the first is what somebody reaches for anyway. There is no
export button, deliberately.

**Three marks, one stylesheet.** `data-print="hide"` on the app header and
footer, `data-print="keep"` on anything that reads as nonsense when halved, and
`data-print="only"` / `"running"` for what exists on paper alone. The rules
live in `globals.css` under one `@media print`, not on the report page, because
"navigation does not print" is true of every page.

**The packet now says whose it is.** `patient.displayName` is read on the
server with the rest of the packet, so the identity and the data come from one
request and cannot disagree. It also says what it cannot do: the product holds
a name and no date of birth or health-service number, so the page states that
it identifies an account rather than a verified patient record, instead of
leaving a clinician to assume a match was made.

**Identification repeats on every sheet, twice over.** The document title is
set to name and period, which every browser prints in its own page header
alongside a page number. And a `position: fixed` line does the same
independently, because a reader can switch the browser's headers off. Page one
carries the full block, so no page is anonymous.

**What the measurements changed.** Every number below was read out of a printed
PDF, page by page, not estimated:

| | Pages | Worst page |
|---|---|---|
| Before | 9 | 134 characters |
| After | 6 | 918 characters |

The three wasted sheets came from `break-inside: avoid` on whole sections and
whole findings. A finding grew past a page this month — measurements,
alternatives, record quality — so keeping it whole pushed it to a fresh sheet
and left the previous one nearly empty. The rule now applies to the smallest
thing that reads as nonsense when halved, never to the largest thing that would
look tidy whole.

**A collapsed `<details>` cannot be opened from CSS.** Chrome hides the body
through the element's own shadow slot. The obvious stylesheet attempt — hide
the summary, reveal its siblings — removes the label as well and reveals
nothing, which was verified by printing the evidence page and finding both gone
from the PDF. `CompetingExplanations` opens them on `beforeprint` and closes
them again on `afterprint`, which is the only thing that works.

**How to check it.** Print to PDF and read the PDF back; do not trust a
screenshot of the screen. `browse pdf --format a4 --print-background` renders
through the print stylesheet, and text can be extracted page by page. Note that
CDP printing does not fire `beforeprint`, so the disclosure handler has to be
checked by dispatching the event.

---

## 7. The public pages must not promise what is not built

`PRODUCT.md` says the page renders the real thing, and that a health product
faking its own screenshots has already told you something. That is enforced by
convention rather than by code, so it needs watching.

No loop step on `/how-it-works` carries a **"Being built"** label any more:
step four, weighing competing explanations, was the last and it came off when
that shipped (§6c). Everything on the public pages now describes something that
exists. The landing page's finding quotes the strings the engine actually
emits, and a test asserts no step carries the flag while also asserting the
flag still exists to be used.

Three labels have come off, each when the thing it covered started existing:
the proposed-trial panel in Ticket 4, the clinician summary in Ticket 5, and
weighing the explanations in Competing Explanations v1. That is the only reason
a label should ever come off. Both panels are typeset
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
readers evaluating the platform and it quotes specific numbers: 139 unit tests,
184 integration, 104 engine, twenty migrations, six guard triggers, eleven
domain schemas, and the demo engine recovering about -1.05 against a seeded
-1.3.

**The test counts are now enforced.** `frontend/test/test-counts.spec.ts`
reads the three numbers out of the page and counts the suites from source. It
went stale twice before that existed — once when the timezone work added tests
and once when the post-meal work did — and it caught a third drift within
minutes of being written, when v1.1 added a backend test.

It counts from source rather than by running the suites, so it knows about two
things that would otherwise make it lie, and refuses rather than guessing: it
asserts `it.each` is absent from the backend suites, because one declaration
becoming many tests would silently undercount, and it expands
`@pytest.mark.parametrize` and throws on any form it does not recognise. The
frontend's own count is deliberately not claimed on the page, because that
suite does use `it.each` and the guard could not check it.

The other numbers on the page — twenty migrations, six guard triggers, eleven
domain schemas, the demo engine recovering about -1.05 against a seeded -1.3 —
are still unenforced. Re-check those by hand, or extend the guard. It embeds
the same `LoopSteps` component as `/how-it-works`, so the build labels cannot
drift between the two. It deliberately carries no market sizing, revenue model,
user count or funding ask, and says so on the page — those would be the only
unverifiable claims on the site.

If you build one of those, remove its label. If you add a claim, check it is
true first.

---

## 7a. What the site tells a machine

`frontend/src/lib/seo.ts` holds one registry, `PUBLIC_PAGES`, and it is the
only place a public route is declared indexable. The sitemap is generated from
it, every page builds its own title, description, canonical and Open Graph
block from its entry, and the tests read it. A page cannot therefore be in the
sitemap with one description and on the screen with another, and a page nobody
registered is a page no crawler is invited to.

**Adding a public page means adding it to that registry.** The test suite fails
if a registered route has no page module or a page module has no registered
route, so the two cannot come apart quietly.

**`DISALLOWED_PATHS` is the other half.** `robots.ts` reads it and so does the
test that proves none of those paths ever reaches the sitemap. It is a crawl
instruction and not access control: what actually stops a stranger reading a
record is the access token the API demands. What this stops is a signed-in page
turning up in a search result, which is a different problem with a different
answer.

**`MedicalWebPage` goes on two pages and no others.** `/type-2-diabetes` and
`/prediabetes` explain something about the condition. Everything else describes
the software, however much diabetes it mentions, and
`medicalWebPageSchema()` throws if it is handed a page whose `kind` is not
`health` — a test calls it on four product pages to prove it. Structured data is
a set of assertions about what a thing is, and a health product that marks all
its marketing as medical content has made a claim it cannot support. The
schemas also carry no `lastReviewed`: schema.org treats that as saying somebody
qualified checked the content on that date, and nothing here has been through
clinical review.

**The banned-claims test matches sentences, not pages.** The same words are
fine or forbidden depending on which side of a negation they sit on — "does not
calculate insulin doses" is the copy this product must have, and a check that
could not tell it from an offer of insulin advice would push the site into
writing worse disclaimers to satisfy a test. There is a test asserting the
check still fails on an unnegated claim, because a subtle guard that quietly
stops guarding is worse than none.

The rendered text is what gets checked, not the page source, for the same
reason the `<h1>` count is: this site's copy and headings both arrive through
shared components.

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
| PostgreSQL 17.11 | `10.10.5.185:5432` | TimescaleDB 2.29.2, pgvector 0.8.6, pgcrypto. 11 domain schemas, 30 tables, 20 migrations. TLS verified against an internal CA. Six guard triggers: `audit_events_append_only`, `predictions_immutable`, `prediction_outcomes_immutable`, `diabetes_safety_flags_append_only`, `experiments_active_requires_prediction`, `experiments_completed_requires_outcome` |
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

**The public site has no domain, and the SEO layer needs one.**
`NEXT_PUBLIC_SITE_URL` is a **build argument** for the frontend image, not a
runtime variable: Next inlines `NEXT_PUBLIC_*` during the build, so setting it
in `environment:` does nothing at all and the wrong value is already compiled
in by the time the container starts. It ends up in every canonical URL, every
`og:url`, `robots.txt` and the whole sitemap.

Unset, it falls back to `http://localhost:3000`. That is deliberate and it is
the safer of the two failures — a plausible-looking default would point the
entire sitemap at a host nobody owns, and the only symptom would be a site that
never appears in a search result. A test in `frontend/test/seo.spec.tsx` fails
if that fallback is ever quietly replaced with a guessed domain.

So: pick the domain, then build the frontend image with
`--build-arg NEXT_PUBLIC_SITE_URL=https://…`. Deploying without it does not
break the site; it publishes a correct site under the wrong name, which is
worse, because nothing goes red.

**Checking a deployment.** `npm run canary -- <base-url>` reports whether
something should carry traffic, entirely over HTTP — no shell on the host, no
container environment. Health failures (process, database, object storage) fail
it anywhere; posture failures (verified TLS, shared limits) are warnings unless
`--require-production`, because both are states the platform runs in on purpose
and a gate that goes red for the shipped configuration gets switched off.
`/api/health/posture` is what it reads.

## 10a. Launch hardening

The production domain is **wellovue.com**. `infra/README.md` § *Going live* is
the runbook; this is what changed and why.

**One switch makes every blocker fatal.** `PUBLIC_LAUNCH=true`:

- the **frontend image will not build** while `[LEGAL ENTITY]` or any of the
  other four placeholders is in a user-facing page — the check runs during the
  image build, because by boot the page is already compiled; and
- the **backend will not start** while any runtime blocker is open. It prints
  each one with what fixes it, and exits.

Both directions were verified against the real stack: with `TRUST_PROXY` off it
refuses and names `client-addresses-not-known`; with it on it logs "serving the
public with no outstanding blockers" and listens.

**Deliberately not derived from `NODE_ENV`.** The containers already run with
`NODE_ENV=production` because that is how a Node app is built, so tying the gate
to it would fail every developer's `docker:up` — and a gate that goes red for
the configuration something shipped with is a gate somebody switches off.

**`launchBlockers()` is one computation with three consumers**: the boot
sequence that refuses, `/api/health/posture` that reports, and
`scripts/canary.mjs` that gates a deploy. A launch checklist living in three
places is one that disagrees with itself on the day it matters.

**The forwarding chain has three links and the middle one was broken.** Caddy
overwrites `X-Forwarded-For`, the frontend's `/api` proxy passes it through,
the backend trusts exactly one hop. That middle link did not exist: the proxy
dropped the header unconditionally, which was right with nothing trustworthy in
front and would have silently defeated the whole thing behind a real proxy —
every request in the deployment keyed on one container. It now forwards only
when its own `TRUST_PROXY` is set. **Set it on both, or the chain breaks at the
frontend**, which is the link people forget because nothing about it looks like
a proxy.

**The deployment is Coolify behind a Cloudflare Tunnel**, and that changed the
answer to the forwarding question rather than just the plumbing. Nothing in
this repository terminates TLS — Cloudflare does, at the edge — and no service
publishes a port, because `cloudflared` dials out and is the only ingress. An
earlier version of the production overlay ran Caddy for TLS; it is gone,
because on this host it would fight Coolify's own proxy for 80 and 443 and its
ACME challenge needs an inbound port 80 that a tunnel deliberately does not
provide.

**Cloudflare appends to `X-Forwarded-For`, and that is a security problem, not
a formatting one.** It adds the true client address to whatever the caller
already put in that header, so the leftmost entry is a value the caller chose.
The throttle guard used to read exactly that — `request.ips[0]` — which was
correct behind a proxy that overwrites and would have handed an attacker a
fresh rate-limit bucket on every request behind one that appends. It reads
`CLIENT_IP_HEADER` (`cf-connecting-ip`) now, and falls back to an address it
can vouch for rather than to a guess: coarse, useless for per-visitor limits,
and unforgeable, which is the right direction to fail in.

The frontend's `/api` proxy strips `cf-connecting-ip` and `true-client-ip`
along with the standard forwarding headers when its own `TRUST_PROXY` is off.
They are ordinary request headers, and the one the backend keys on is the one
nobody thinks to check.

**The canary now checks what a deploy gate needs.** Applied migrations against
the count in the tree, the blockers the process itself reports, the public pages
over the real origin, and that `/api/evidence` and `/api/reports/clinician`
*refuse* a caller with no session — a 200 there is the worst result it can
produce. It has no credentials and should not have any; what it can prove is
that somebody's record is not reachable without them.

**Logs cannot carry a record.** The slow-query log prints the first 120
characters of a statement and never its parameters, which is safe only because
every query is parameterised — a test asserts no query is built by
interpolating a value, which closes injection and log leakage together.

**Legal review is a CI job that always fails.** Deleting it is the record: it
appears in the history with a name against it, which is a more honest artefact
than a boolean somebody set. Filling in the placeholders is not review.

**Coolify takes one compose path**, so `infra/docker/docker-compose.coolify.yml`
is self-contained rather than base-plus-overlay. It duplicates most of
`docker-compose.yml` on purpose: a file somebody clicks "deploy" on should be
readable in one place. A test asserts both production descriptions set the same
switches, because whichever one is wrong is the one that ships.

**The first Coolify deploy fails, and should.** `PUBLIC_LAUNCH` is a build
argument on the frontend image, so the build runs the placeholder check and
stops while the Privacy policy still says `[LEGAL ENTITY]`. To stand the stack
up before the legal work — to prove the tunnel and the database — point Coolify
at `infra/docker/docker-compose.yml` instead: no launch switches, and every
page it serves is honest about being unfinished.

### Still not done, and not something code can do

- **Nothing is pointed at anything.** The tunnel, its public hostname and the
  Coolify application have not been created. The Cloudflare records must stay
  **proxied**: a grey-cloud record points at nothing, and the orange cloud is
  what guarantees `CF-Connecting-IP` is set on every request.
- **Backups are documented and unautomated.** No schedule, no off-host copy,
  and the restore has not been run end to end. A backup nobody has restored is
  a belief. See `infra/README.md` § *Backups and restore*.
- **A lawyer has not read the pages.**

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

`docs/diabetes-wide-platform.md` § **Next Implementation Ticket** tracks the
loop, and the loop is closed. What is left is the launch hardening track,
and none of it is product work: a DNS name, a reverse proxy that sets
`X-Forwarded-For`, TLS termination, the final database TLS mode, the five legal
placeholders, a lawyer, and a production canary. §10 has each one.

**The most recent review of the engine** (28 August) said it well: the engine
is safe and directionally right, but it understands "patterns in diabetes data"
more than it understands diabetes. Its first three recommendations shipped in
`4c34810` and `71964d7` — timezone-aware hours, timezone-aware CSV import,
refusing an unresolvable zone, and a version bump. Its fourth, richer post-meal
features, is Post-Meal Intelligence v1 and has shipped, along with the v1.1
follow-up that put those measurements in the clinician packet (§6a). Its fifth,
data quality and CGM coverage, has shipped too (§6b). Every recommendation from
that review is now done, and Competing Explanations v1 (§6c) closed the last
unbuilt step of the product loop.

**Two things the coverage work leaves open**, neither big enough to be its own
item above. The shape and coverage thresholds have not had clinical review and
are marked as such in `thresholds.py`; they decide a word rather than a number,
which is why shipping them unreviewed was defensible and why reviewing them is
still worth doing. And coverage caps strength but does not touch `confidence`,
which is deliberate — confidence is the engine's statistical claim and a
prediction records it — but it does mean a low-coverage finding reports a
confident number beside a weak word. That reads oddly and is honest; if it
should change, change it knowingly.

Gestational and Type 1 stay parked behind clinical review regardless of how
ready the engine looks. That gate is doing its job; do not route around it.

### Before you touch anything

- **`npm ci`, never `npm install`.** See §8. To add a dependency, resolve the
  lockfile from a space-free path.
- **`npm run db:migrate` will not resolve `medical-db` from a developer Mac**
  until `echo "10.10.5.185 medical-db" | sudo tee -a /etc/hosts` has been run.
  This has not been done on the machine this was written from. The containers
  carry their own mapping and are unaffected. Until then, migrate from a
  container:
  ```bash
  docker run --rm --add-host medical-db:10.10.5.185 -v "$PWD":/w -w /w \
    --env-file <(grep -E '^DATABASE_URL=|^DATABASE_SSL_REJECT' .env) \
    -e DATABASE_CA_CERT=/w/infra/db/ca.crt node:22-slim node scripts/migrate.mjs
  ```
- **`npm run docker:up` does not reliably rebuild every service.** It has left
  the metabolic engine running two-and-a-half-hour-old code while reporting
  healthy. After changing the engine or the shared contract, force it:
  `docker compose -f infra/docker/docker-compose.yml --env-file .env up -d
  --build --force-recreate metabolic-engine backend frontend`. A stale
  container is the single most likely reason a change "did not work".
- **Read `DESIGN.md` before changing any interface**, and §7 before changing
  any public page.
- **The integration suite fails about one run in six** for reasons that are not
  the product. See §8; do not go looking for an auth bug.
