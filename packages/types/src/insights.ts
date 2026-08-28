import { z } from 'zod';
import { confidenceSchema, uuidSchema } from './common';
import { careModeSchema, safetyFlagSchema } from './diabetes';
import { experimentSchema } from './experiments';

/**
 * The contract between the quantitative engine and everything downstream.
 *
 * A finding is produced by a model, never by a language model. An LLM may
 * only phrase an existing finding — it must not create one. See
 * docs/technical-architecture.md, "Metabolic Intelligence Service".
 */
/**
 * One group a finding compared, in glucose a reader would recognise.
 *
 * Absolute mmol/L rather than a rise, because a rise of 3.1 says nothing about
 * whether the person ended up in range and 6.0 rising to 9.1 says it exactly.
 * That is what lets a finding be drawn against the target band instead of
 * printed as a sentence with a number in it.
 *
 * `baselineMmol` is null for a level rather than a movement — morning glucose
 * has nowhere to rise from — and a chart draws one mark instead of a curve.
 */
export const curvePointSchema = z.object({
  /** Minutes since the meal. Zero is the baseline reading. */
  minutes: z.number().int(),
  mmol: z.number(),
});
export type CurvePoint = z.infer<typeof curvePointSchema>;

export const groupMeasureSchema = z.object({
  label: z.string(),
  n: z.number().int().min(0),
  baselineMmol: z.number().nullable().default(null),
  peakMmol: z.number().nullable().default(null),
  /**
   * The group's mean response, sampled every fifteen minutes.
   *
   * Averaged across the group's meals at each offset, and a point is kept only
   * where a third of them had a reading — a tail thinning to one meal would
   * draw that meal's noise as the pattern. Empty for a level rather than a
   * movement, where a line would invent motion nobody measured.
   */
  curve: z.array(curvePointSchema).default([]),
});
export type GroupMeasure = z.infer<typeof groupMeasureSchema>;

export const structuredFindingSchema = z.object({
  findingType: z.string().min(1),
  summary: z.string().min(1),
  effectEstimate: z.number().nullable(),
  effectUnit: z.string().nullable(),
  confidence: confidenceSchema,
  sampleCount: z.number().int().min(0),
  /** Always populated. An empty limitations list is a bug, not a strong finding. */
  limitations: z.array(z.string()),
  /** Set when the finding touches anything a clinician should weigh in on. */
  clinicianReviewRecommended: z.boolean().default(false),

  /** The groups compared, when the finding compared any. Empty for lab trends. */
  comparison: z.array(groupMeasureSchema).default([]),

  /**
   * Reported, but not as a limitation.
   *
   * It used to be a sentence inside `limitations`, which made a list of things
   * the finding cannot account for read as a lab report — and a p-value is not
   * a limitation, it is a statistic. Its own field so a surface can put it
   * where a technical detail belongs, or leave it out entirely.
   */
  pValue: z.number().nullable().default(null),
  /** What the user could log to make this answer sharper. */
  wouldImproveWith: z.array(z.string()).default([]),
});
export type StructuredFinding = z.infer<typeof structuredFindingSchema>;

export const evidenceStrengthSchema = z.enum([
  'insufficient',
  'weak',
  'moderate',
  'strong',
]);
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;

/**
 * Maps sample count and confidence onto the single word shown to the user.
 * Kept in shared code so the API, web app, and reports never disagree.
 */
export function evidenceStrength(
  sampleCount: number,
  confidence: number,
): EvidenceStrength {
  if (sampleCount < 5) return 'insufficient';
  if (sampleCount < 10 || confidence < 0.6) return 'weak';
  if (sampleCount < 20 || confidence < 0.8) return 'moderate';
  return 'strong';
}

/**
 * What the engine is asked.
 *
 * Mirrors `PatternRequest` in `metabolic-engine/app/models/findings.py`. These
 * two are the same contract in two languages and must be changed together.
 */
export const patternRequestSchema = z.object({
  userId: uuidSchema,
  from: z.coerce.date(),
  to: z.coerce.date(),
  patterns: z.array(z.string()).optional(),
  /**
   * Which model of a body the record should be read with.
   *
   * Derived by the API from the recorded diagnosis and the flags in force,
   * never taken from a browser. The engine refuses any detector outside the
   * care mode it declares support for, so this is what makes that refusal
   * possible — and the engine defaults it to `unknown`, which nothing
   * supports, so omitting it yields a refusal rather than the Type 2 analysis.
   */
  careMode: careModeSchema,
  /** Safety flags in force. Some detectors are blocked by these whatever the care mode. */
  activeFlags: z.array(safetyFlagSchema).default([]),
  /**
   * The timezone the engine reads hours in.
   *
   * Every timestamp reaches the engine as UTC, and three findings depend on
   * hour-of-day: the morning window, the fasting window, and the late-meal
   * split. Defaults to UTC, which is what the engine did before this existed —
   * so a caller that forgets it gets today's behaviour rather than a silent
   * shift, and the default is a known state rather than a guess.
   */
  timezone: z.string().min(1).max(64).default('UTC'),
});
export type PatternRequest = z.infer<typeof patternRequestSchema>;

export const patternResponseSchema = z.object({
  userId: uuidSchema,
  generatedAt: z.coerce.date(),
  modelVersion: z.string(),
  findings: z.array(structuredFindingSchema),
});
export type PatternResponse = z.infer<typeof patternResponseSchema>;

const STRENGTH_ORDER: Record<EvidenceStrength, number> = {
  strong: 0,
  moderate: 1,
  weak: 2,
  insufficient: 3,
};

/**
 * The strength of a whole finding, rather than of its numbers alone.
 *
 * A finding with no effect estimate has not measured anything, whatever its
 * sample count: the engine returns those when a comparison group is too thin
 * to describe. `evidenceStrength(8, 0)` would call that "weak evidence", which
 * overstates it — there is no evidence yet, only a count of what was logged.
 */
export function findingStrength(
  finding: Pick<StructuredFinding, 'effectEstimate' | 'sampleCount' | 'confidence'>,
): EvidenceStrength {
  if (finding.effectEstimate === null) return 'insufficient';
  return evidenceStrength(finding.sampleCount, finding.confidence);
}

/**
 * Puts the findings the data can support first, firmest first.
 *
 * The engine returns findings in detector order, which is an implementation
 * detail of the engine. Ordering lives here rather than in either caller so
 * the API, the web app, and a printed clinician report present the same
 * record in the same order. Ties keep the larger sample first, then the
 * engine's own order.
 */
export function orderFindings(findings: StructuredFinding[]): StructuredFinding[] {
  return [...findings].sort((a, b) => {
    const byStrength = STRENGTH_ORDER[findingStrength(a)] - STRENGTH_ORDER[findingStrength(b)];
    if (byStrength !== 0) return byStrength;
    return b.sampleCount - a.sampleCount;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest window the evidence endpoint will ask the engine to analyse. */
export const MAX_EVIDENCE_WINDOW_DAYS = 365;

/** Window used when the caller does not name one. */
export const DEFAULT_EVIDENCE_WINDOW_DAYS = 30;

/**
 * The time range an evidence request covers.
 *
 * Deliberately carries no user id. The engine will answer about any user id it
 * is handed, so the identity comes from the verified access token on the
 * server and can never be supplied by the browser.
 *
 * The upper bound on the window is not a performance guess: the engine loads
 * every reading in the range into memory, so an unbounded range is a way to
 * make one request cost arbitrarily much.
 */
export const evidenceQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    return {
      to,
      from: v.from ?? new Date(to.getTime() - DEFAULT_EVIDENCE_WINDOW_DAYS * DAY_MS),
    };
  })
  .refine((v) => v.to > v.from, { message: '`from` must be before `to`' })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_EVIDENCE_WINDOW_DAYS * DAY_MS, {
    message: `The window cannot be longer than ${MAX_EVIDENCE_WINDOW_DAYS} days`,
  });
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

/**
 * The one safe experiment a finding suggests testing.
 *
 * A finding says what already happened; an experiment is how somebody finds
 * out whether it happens on purpose. This is the join between the two, and it
 * is deliberately narrow: one template per finding type, and only for findings
 * where a week of alternating behaviour would actually settle something.
 *
 * Most finding types are absent, and that is the correct answer rather than a
 * gap to fill later. A morning glucose average has no one-week test a person
 * can run alone. An HbA1c trend moves over quarters. Offering a button that
 * proposes a test which cannot resolve the question would be worse than
 * offering nothing, because it would look like the product knew what to do.
 *
 * Every template here is drawn from ALLOWED_EXPERIMENT_TEMPLATES, and a test
 * asserts it. That does not mean a proposal is always allowed: the classifier
 * still gates it against the person's care profile, so the same finding
 * proposes a runnable test for one reader and a clinician conversation for
 * another. What it does mean is that this map can never be the thing that
 * surfaces a blocked protocol.
 */
const FINDING_EXPERIMENTS: Record<
  string,
  { template: string; title: string; question: string; protocol: Record<string, unknown> }
> = {
  post_meal_walk_effect: {
    template: 'post_meal_walk',
    title: 'Walking after a meal',
    question:
      'Does walking after a meal actually lower the rise for me, or were those days different in some other way?',
    protocol: {
      days: 6,
      instruction:
        'Eat a similar meal on six days. Walk after three of them, chosen at random rather than when you feel like it.',
      records: ['meal', 'activity', 'glucose'],
    },
  },
  late_evening_meal_response: {
    template: 'meal_timing',
    title: 'Eating the same meal earlier',
    question:
      'Is the larger rise about the hour I eat, or about what I happen to eat late?',
    protocol: {
      days: 6,
      instruction:
        'Eat the same meal on six days: three of them before 19:00, three after 20:00.',
      records: ['meal', 'glucose'],
    },
  },
  meal_timing_association: {
    template: 'meal_timing',
    title: 'Eating the same meal earlier',
    question: 'Does the time of day change the rise, holding the meal itself steady?',
    protocol: {
      days: 6,
      instruction:
        'Eat the same meal on six days, half early and half late, and log each one.',
      records: ['meal', 'glucose'],
    },
  },
  post_meal_response: {
    template: 'meal_order',
    title: 'Changing the order of a meal',
    question:
      'Does eating the protein and vegetables before the carbohydrate change my rise?',
    protocol: {
      days: 6,
      instruction:
        'Eat the same meal on six days. On three of them, eat everything else before the carbohydrate.',
      records: ['meal', 'glucose'],
    },
  },
};

export interface ExperimentProposal {
  template: string;
  title: string;
  question: string;
  protocol: Record<string, unknown>;
}

/**
 * The proposal a finding supports, or null when it supports none.
 *
 * Null for a finding with no effect estimate, whatever its type. A detector
 * that could not measure anything has not identified a question worth a week
 * of somebody's life, and "not enough data" is the wrong thing to hand a
 * person a test for.
 */
export function proposalFromFinding(
  finding: Pick<StructuredFinding, 'findingType' | 'effectEstimate'>,
): ExperimentProposal | null {
  if (finding.effectEstimate === null) return null;
  return FINDING_EXPERIMENTS[finding.findingType] ?? null;
}

/**
 * What a finding is called, and what kind of diabetes question it answers.
 *
 * `findingType` is the engine's own identifier and it belongs in the record —
 * a clinician quotes it, the packet keys on it, and it must not drift. It does
 * not belong on a screen: `late_evening_meal_response` tells somebody with
 * diabetes nothing about their evening meal.
 *
 * This is a display name for an enum, in the same category as `careModeLabel`
 * and nothing like a finding. It restates what the detector already measures;
 * it makes no claim the engine has not already made, and it must never be
 * where a new one is introduced. Anything that interprets a person's data
 * belongs in the engine, behind the review that gets it there.
 *
 * The lens exists because the same number means different things in different
 * physiology. "A 3.1 mmol/L larger rise" is a post-meal response question, and
 * saying so is what separates a diabetes platform from an analytics dashboard
 * that happens to be pointed at glucose.
 */
export interface FindingPresentation {
  title: string;
  lens: string;
}

const FINDING_PRESENTATION: Record<string, FindingPresentation> = {
  late_evening_meal_response: {
    title: 'Late meals and glucose rise',
    lens: 'Post-meal glucose response',
  },
  post_meal_walk_effect: {
    title: 'Walking after meals',
    lens: 'Activity and post-meal response',
  },
  post_meal_response: {
    title: 'Your typical meal response',
    lens: 'Post-meal glucose response',
  },
  morning_glucose_pattern: {
    title: 'Morning glucose',
    lens: 'Fasting and waking glucose',
  },
  hba1c_trend: { title: 'HbA1c over time', lens: 'Long-term glucose control' },
  weight_trend: { title: 'Weight over time', lens: 'Metabolic risk factors' },
  fasting_glucose_trend: {
    title: 'Waking glucose over time',
    lens: 'Fasting and waking glucose',
  },
  activity_consistency: { title: 'How regular your activity is', lens: 'Activity patterns' },
  meal_timing_association: {
    title: 'Meal timing and glucose rise',
    lens: 'Post-meal glucose response',
  },
  care_mode_unsupported: {
    title: 'Not yet interpreted for your care profile',
    lens: 'Care profile',
  },
};

/**
 * Falls back to the identifier made readable rather than to the identifier.
 *
 * A detector added tomorrow without an entry here shows "Sleep and morning
 * glucose", not `sleep_morning_glucose`. The fallback is deliberately plain so
 * that a missing entry looks unfinished to whoever ships the detector, without
 * ever showing a reader a database value.
 */
export function findingPresentation(findingType: string): FindingPresentation {
  const known = FINDING_PRESENTATION[findingType];
  if (known) return known;

  const words = findingType.replace(/_/g, ' ').trim();
  return {
    title: words.charAt(0).toUpperCase() + words.slice(1),
    lens: 'Pattern in your data',
  };
}

/** Every template this map can produce. Used to prove none of them is unsafe. */
export function proposableTemplates(): string[] {
  return [...new Set(Object.values(FINDING_EXPERIMENTS).map((e) => e.template))];
}

/**
 * A prediction made before an experiment runs.
 *
 * The point of the platform, and the one record it must never be able to
 * revise. A system that scores itself after the fact can always be right; a
 * system that writes down what it expects, then cannot touch it, produces the
 * only number worth anything — how often it was right about this person
 * specifically.
 *
 * `prediction` and `inputSnapshot` are both generated on the server. Nothing a
 * browser sends decides what was expected, because the accountability is
 * meaningless if the thing being held accountable chose its own answer after
 * seeing the question.
 */
export const predictionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  /**
   * The experiment this expectation is about.
   *
   * Null only for rows written before migration 0018 gave the link a column of
   * its own. Exposed because a screen showing predicted against observed has to
   * pair the two, and pairing them by reading `inputSnapshot` would mean
   * trusting the shape of a jsonb blob for something the database already
   * enforces as a foreign key.
   */
  experimentId: uuidSchema.nullable(),
  predictionType: z.string(),
  madeAt: z.coerce.date(),
  targetAt: z.coerce.date().nullable(),
  modelVersion: z.string(),
  /** What was expected, in the engine's own terms. */
  prediction: z.record(z.unknown()),
  /** Everything needed to replay the reasoning: the finding, the window, the care mode. */
  inputSnapshot: z.record(z.unknown()),
  confidence: confidenceSchema.nullable(),
  status: z.enum(['pending', 'matched', 'expired', 'unmatchable']),
});
export type Prediction = z.infer<typeof predictionSchema>;

/**
 * What a prediction actually says, once it is read rather than stored.
 *
 * `prediction` is jsonb because the shape belongs to whatever made it, and a
 * column per field would have to change every time a new kind of prediction
 * arrives. Reading it back through a schema rather than a cast is the other
 * half of that bargain: a row this does not recognise comes back as null and
 * is shown as unreadable, instead of rendering `undefined mmol/L` at somebody
 * who is trying to find out whether the platform was right about them.
 */
export const expectationSchema = z.object({
  expectedEffect: z.number(),
  unit: z.string().nullable(),
  statement: z.string(),
  basisFindingType: z.string(),
});
export type Expectation = z.infer<typeof expectationSchema>;

export function expectationFrom(
  prediction: Pick<Prediction, 'prediction'>,
): Expectation | null {
  const parsed = expectationSchema.safeParse(prediction.prediction);
  return parsed.success ? parsed.data : null;
}

/**
 * What was actually observed.
 *
 * Separate from the prediction, in its own table, written once. Attaching an
 * outcome is the only thing that ever touches a prediction, and even then it
 * only advances the status: the expectation itself stays exactly as written.
 *
 * There is one way to send this, and it is completing the experiment. An
 * outcome that could be recorded on its own would leave the experiment running
 * forever with its answer already known, and a second door into the same write
 * is how the two eventually disagree.
 */
export const attachOutcomeSchema = z.object({
  observedAt: z.coerce.date(),
  /** The measured value, in the unit the prediction named. */
  observedEffect: z.number(),
  notes: z.string().max(1000).optional(),
});
export type AttachOutcomeInput = z.infer<typeof attachOutcomeSchema>;

/**
 * The scoring, computed once on the server when the outcome is written.
 *
 * Stored rather than derived on read, because it is part of the record: a
 * figure recomputed at display time is a figure that changes when the code
 * that computes it changes, and the whole point of these rows is that they do
 * not move.
 *
 * `expectedEffect` is nullable for the same reason the engine's own estimates
 * are — a prediction whose expectation could not be read as a number is scored
 * as unscoreable rather than as zero.
 */
export const errorSummarySchema = z.object({
  expectedEffect: z.number().nullable(),
  observedEffect: z.number(),
  /** Signed. Whether the platform over- or under-estimated is the interesting half. */
  error: z.number().nullable(),
  absoluteError: z.number().nullable(),
});
export type ErrorSummary = z.infer<typeof errorSummarySchema>;

export const predictionOutcomeSchema = z.object({
  id: uuidSchema,
  predictionId: uuidSchema,
  observedAt: z.coerce.date(),
  outcome: z.object({
    observedEffect: z.number(),
    notes: z.string().nullable(),
  }),
  errorSummary: errorSummarySchema.nullable(),
  createdAt: z.coerce.date(),
});
export type PredictionOutcome = z.infer<typeof predictionOutcomeSchema>;

/**
 * An experiment with the expectation written before it ran and, once it is
 * finished, what actually happened.
 *
 * One response rather than three requests, because the screen it exists for is
 * meaningless in pieces: predicted without observed is a promise, and observed
 * without predicted is a measurement of nothing in particular.
 */
export const experimentDetailSchema = z.object({
  experiment: experimentSchema,
  prediction: predictionSchema.nullable(),
  outcome: predictionOutcomeSchema.nullable(),
});
export type ExperimentDetail = z.infer<typeof experimentDetailSchema>;
