import { z } from 'zod';
import { dataSourceSchema, glucoseUnitSchema, uuidSchema } from './common';

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
