import { z } from 'zod';
import { dataSourceSchema, glucoseUnitSchema, uuidSchema } from './common';

/**
 * The target range, in mmol/L.
 *
 * The one declaration. It used to be four: the backend's time-in-range
 * calculation, two frontend components, the landing page's chart data, and the
 * Python engine's thresholds — each with its own copy of 3.9 and 10.0, each
 * free to drift. Nothing had ever drifted, which is exactly why it was worth
 * fixing before something did: a clinician reading a time-in-range percentage
 * computed against one boundary, beside a chart drawn against another, has no
 * way to see the disagreement.
 *
 * These are population defaults, not this person's targets. Per-user ranges are
 * deliberately not stored yet (see migration 0013): a column nothing reads is
 * worse than no column. When they arrive, this is what they override, and this
 * is where the fallback stays.
 *
 * `thresholds.py` in the metabolic engine carries the same two numbers because
 * it cannot import TypeScript. It is not trusted to stay correct on its own:
 * `backend/test/target-range.spec.ts` reads that file and fails if it disagrees
 * with these.
 */
export const TARGET_LOW_MMOL = 3.9;
export const TARGET_HIGH_MMOL = 10.0;

/** Where a reading sits relative to target. Paired with a label, never colour alone. */
export type GlucoseZone = 'below' | 'in' | 'above';

/**
 * Both bounds are inclusive: 3.9 and 10.0 are in range.
 *
 * This matches what all four sites already did, so unifying them changed no
 * behaviour. It is stated here because it is the detail that would otherwise
 * be re-decided by whoever writes the fifth caller, and a reading exactly on
 * the boundary is the one a person is most likely to be looking at when they
 * care about the answer.
 */
export function glucoseZone(mmol: number): GlucoseZone {
  if (mmol < TARGET_LOW_MMOL) return 'below';
  if (mmol > TARGET_HIGH_MMOL) return 'above';
  return 'in';
}

export function isInTargetRange(mmol: number): boolean {
  return glucoseZone(mmol) === 'in';
}

export const glucoseTrendSchema = z.enum([
  'rising_fast',
  'rising',
  'steady',
  'falling',
  'falling_fast',
]);

export const createGlucoseSampleSchema = z.object({
  measuredAt: z.coerce.date(),
  value: z.number().positive().max(99),
  unit: glucoseUnitSchema,
  trend: glucoseTrendSchema.optional(),
  source: dataSourceSchema.default('manual'),
  deviceId: uuidSchema.optional(),
  quality: z.string().max(40).optional(),
});
export type CreateGlucoseSampleInput = z.infer<typeof createGlucoseSampleSchema>;

export const glucoseSampleSchema = createGlucoseSampleSchema.extend({
  userId: uuidSchema,
  insertedAt: z.coerce.date(),
});
export type GlucoseSample = z.infer<typeof glucoseSampleSchema>;

/** Bulk import from a CGM or meter export. */
export const importGlucoseSchema = z.object({
  source: dataSourceSchema,
  samples: z.array(createGlucoseSampleSchema).min(1).max(20_000),
});
export type ImportGlucoseInput = z.infer<typeof importGlucoseSchema>;

export const glucoseImportResultSchema = z.object({
  received: z.number().int(),
  imported: z.number().int(),
  /** Duplicates on (user, time, source) are skipped, not overwritten. */
  duplicates: z.number().int(),
  rejected: z.array(
    z.object({ index: z.number().int(), reason: z.string() }),
  ),
});
export type GlucoseImportResult = z.infer<typeof glucoseImportResultSchema>;

export const glucoseSummarySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  unit: glucoseUnitSchema,
  sampleCount: z.number().int(),
  mean: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  /** Share of readings inside the target range, 0-1. Null when there is too little data. */
  timeInRange: z.number().min(0).max(1).nullable(),
  timeAboveRange: z.number().min(0).max(1).nullable(),
  timeBelowRange: z.number().min(0).max(1).nullable(),
  /** Made explicit so the UI never presents a thin sample as a firm finding. */
  dataSufficient: z.boolean(),
});
export type GlucoseSummary = z.infer<typeof glucoseSummarySchema>;

/**
 * Query contract for the glucose summary endpoint.
 *
 * Defaults live in the schema rather than the controller so a single pipe can
 * validate the whole query — no schema is parsed by hand, which is what let a
 * bad `unit` surface as a 500.
 */
export const glucoseSummaryQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    unit: glucoseUnitSchema.default('mmol/L'),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    return {
      to,
      from: v.from ?? new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000),
      unit: v.unit,
    };
  })
  .refine((v) => v.to > v.from, { message: '`from` must be before `to`' });
export type GlucoseSummaryQuery = z.infer<typeof glucoseSummaryQuerySchema>;

/** Same shape, without a unit — used for listing raw readings. */
export const glucoseListQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    return { to, from: v.from ?? new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000) };
  })
  .refine((v) => v.to > v.from, { message: '`from` must be before `to`' });
export type GlucoseListQuery = z.infer<typeof glucoseListQuerySchema>;
