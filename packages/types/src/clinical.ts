import { z } from 'zod';
import { dataSourceSchema, uuidSchema } from './common';

export const medicationStatusSchema = z.enum([
  'active',
  'stopped',
  'paused',
  'unknown',
]);

export const createMedicationRecordSchema = z
  .object({
    medicationName: z.string().min(1).max(200),
    doseText: z.string().max(200).optional(),
    route: z.string().max(60).optional(),
    frequencyText: z.string().max(200).optional(),
    startedOn: z.coerce.date().optional(),
    endedOn: z.coerce.date().optional(),
    status: medicationStatusSchema.default('active'),
    source: dataSourceSchema.default('manual'),
  })
  .refine((v) => !v.endedOn || !v.startedOn || v.endedOn >= v.startedOn, {
    message: '`endedOn` must not be before `startedOn`',
    path: ['endedOn'],
  });
export type CreateMedicationRecordInput = z.infer<
  typeof createMedicationRecordSchema
>;

export const medicationRecordSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  medicationName: z.string(),
  doseText: z.string().nullable(),
  route: z.string().nullable(),
  frequencyText: z.string().nullable(),
  startedOn: z.coerce.date().nullable(),
  endedOn: z.coerce.date().nullable(),
  status: medicationStatusSchema,
  source: dataSourceSchema,
  createdAt: z.coerce.date(),
});
export type MedicationRecord = z.infer<typeof medicationRecordSchema>;

/** Labs the platform recognises first. Free text is still accepted. */
export const knownLabTestSchema = z.enum([
  'hba1c',
  'fasting_glucose',
  'egfr',
  'uacr',
  'ldl_c',
  'hdl_c',
  'triglycerides',
  'alt',
  'ast',
  'systolic_bp',
  'diastolic_bp',
  'weight',
  'bmi',
]);

export const createLabResultSchema = z
  .object({
    testName: z.string().min(1).max(200),
    codeSystem: z.string().max(60).optional(),
    code: z.string().max(60).optional(),
    valueNumeric: z.number().optional(),
    valueText: z.string().max(500).optional(),
    unit: z.string().max(40).optional(),
    referenceRange: z.string().max(120).optional(),
    collectedAt: z.coerce.date(),
    source: dataSourceSchema.default('manual'),
  })
  .refine((v) => v.valueNumeric !== undefined || v.valueText !== undefined, {
    message: 'A lab result needs either a numeric or a text value',
  });
export type CreateLabResultInput = z.infer<typeof createLabResultSchema>;
