import { z } from 'zod';

export const uuidSchema = z.string().uuid();

/**
 * Every value the platform did not directly observe carries a confidence.
 * 1.0 means observed; anything lower is inferred and must be shown as such.
 */
export const confidenceSchema = z.number().min(0).max(1);

/** Where a data point came from. Displayed to the user, never hidden. */
export const dataSourceSchema = z.enum([
  'manual',
  'csv_import',
  'cgm_device',
  'glucose_meter',
  'wearable',
  'apple_health',
  'health_connect',
  'clinician',
  'lab_import',
  'inferred',
]);
export type DataSource = z.infer<typeof dataSourceSchema>;

export const glucoseUnitSchema = z.enum(['mmol/L', 'mg/dL']);
export type GlucoseUnit = z.infer<typeof glucoseUnitSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const timeRangeSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((v) => v.to > v.from, { message: '`to` must be after `from`' });
export type TimeRange = z.infer<typeof timeRangeSchema>;

/** mg/dL is the US convention; mmol/L is used elsewhere. Stored as entered, converted for display. */
export const MG_DL_PER_MMOL_L = 18.0182;

export function toMmolL(value: number, unit: GlucoseUnit): number {
  return unit === 'mmol/L' ? value : value / MG_DL_PER_MMOL_L;
}

export function toMgDl(value: number, unit: GlucoseUnit): number {
  return unit === 'mg/dL' ? value : value * MG_DL_PER_MMOL_L;
}
