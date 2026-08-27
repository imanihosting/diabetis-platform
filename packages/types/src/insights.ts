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
