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
export type KnownLabTest = z.infer<typeof knownLabTestSchema>;

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

export const labResultSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  testName: z.string(),
  codeSystem: z.string().nullable(),
  code: z.string().nullable(),
  valueNumeric: z.number().nullable(),
  valueText: z.string().nullable(),
  unit: z.string().nullable(),
  referenceRange: z.string().nullable(),
  collectedAt: z.coerce.date(),
  source: dataSourceSchema,
  createdAt: z.coerce.date(),
});
export type LabResult = z.infer<typeof labResultSchema>;

export const labListQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    testName: z.string().max(200).optional(),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    return {
      to,
      // A lab is not a daily measurement. Two years is the window in which an
      // HbA1c trend is a trend rather than two points.
      from: v.from ?? new Date(to.getTime() - 730 * 24 * 60 * 60 * 1000),
      testName: v.testName,
    };
  })
  .refine((v) => v.to > v.from, { message: '`from` must be before `to`' });
export type LabListQuery = z.infer<typeof labListQuerySchema>;

/**
 * The units the platform expects for the tests it recognises.
 *
 * Not enforced — a lab printout can carry anything and rejecting an unfamiliar
 * unit would lose the reading. Used to prefill the entry form and to say what
 * a trend is measured in, so a number and its unit cannot drift apart on the
 * way to a clinician.
 */
export const KNOWN_LAB_UNITS: Partial<Record<KnownLabTest, string>> = {
  hba1c: 'mmol/mol',
  fasting_glucose: 'mmol/L',
  weight: 'kg',
  bmi: 'kg/m2',
  egfr: 'mL/min/1.73m2',
  uacr: 'mg/mmol',
  ldl_c: 'mmol/L',
  hdl_c: 'mmol/L',
  triglycerides: 'mmol/L',
  systolic_bp: 'mmHg',
  diastolic_bp: 'mmHg',
};
