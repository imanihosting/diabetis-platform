import { z } from 'zod';
import { confidenceSchema, uuidSchema } from './common';
import { careModeSchema, safetyFlagSchema } from './diabetes';

/**
 * The contract between the quantitative engine and everything downstream.
 *
 * A finding is produced by a model, never by a language model. An LLM may
 * only phrase an existing finding — it must not create one. See
 * docs/technical-architecture.md, "Metabolic Intelligence Service".
 */
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

/** Every template this map can produce. Used to prove none of them is unsafe. */
export function proposableTemplates(): string[] {
  return [...new Set(Object.values(FINDING_EXPERIMENTS).map((e) => e.template))];
}
