import { z } from 'zod';
import { uuidSchema } from './common';

/**
 * The diabetes profile: what kind of diabetes, and what the software is
 * therefore allowed to do about it.
 *
 * Type and care mode are separate on purpose. The type is the diagnosis a
 * clinician would write down. The care mode is the operational context the
 * product needs to make safe decisions, and two people with the same diagnosis
 * can need different ones — Type 2 with insulin in the picture carries a
 * hypoglycaemia risk that Type 2 without it does not, and the software has to
 * know which it is looking at before it says anything.
 *
 * See docs/diabetes-wide-platform.md.
 */

export const diabetesTypeSchema = z.enum([
  'type_1',
  'type_2',
  'gestational',
  'prediabetes',
  'other_specific',
  'unknown',
]);
export type DiabetesType = z.infer<typeof diabetesTypeSchema>;

export const careModeSchema = z.enum([
  'type_2_standard',
  'type_2_insulin_supported',
  'prediabetes',
  'gestational',
  'type_1_cgm_insulin',
  'other_specific',
  'unknown',
]);
export type CareMode = z.infer<typeof careModeSchema>;

export const safetyTierSchema = z.enum([
  'standard',
  'clinician_supported',
  'high_risk',
  'pregnancy',
]);
export type SafetyTier = z.infer<typeof safetyTierSchema>;

export const diagnosisSourceSchema = z.enum([
  'self_reported',
  'clinician',
  'imported',
  /** Recorded by the platform rather than answered by anyone. Never treat as fact. */
  'assumed',
]);
export type DiagnosisSource = z.infer<typeof diagnosisSourceSchema>;

export const safetyFlagSchema = z.enum([
  'insulin_therapy',
  'pump_or_automated_insulin_delivery',
  'pregnancy',
  'hypoglycemia_unawareness',
  'history_of_severe_hypoglycemia',
  'kidney_disease',
  'cardiovascular_risk',
  'paediatric_user',
  'clinician_managed_protocol',
]);
export type SafetyFlag = z.infer<typeof safetyFlagSchema>;

export const safetyFlagStatusSchema = z.enum(['active', 'inactive', 'unknown']);
export type SafetyFlagStatus = z.infer<typeof safetyFlagStatusSchema>;

export const diabetesSafetyFlagSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  flag: safetyFlagSchema,
  status: safetyFlagStatusSchema,
  source: diagnosisSourceSchema.or(z.literal('derived')),
  recordedAt: z.coerce.date(),
  metadata: z.record(z.unknown()).default({}),
});
export type DiabetesSafetyFlag = z.infer<typeof diabetesSafetyFlagSchema>;

export const diabetesProfileSchema = z.object({
  userId: uuidSchema,
  diabetesType: diabetesTypeSchema,
  careMode: careModeSchema,
  diagnosedOn: z.coerce.date().nullable(),
  diagnosisSource: diagnosisSourceSchema,
  clinicianSupported: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type DiabetesProfile = z.infer<typeof diabetesProfileSchema>;

/** What a client may change. Care mode is derived, never accepted from a browser. */
export const updateDiabetesProfileSchema = z.object({
  diabetesType: diabetesTypeSchema,
  diagnosedOn: z.coerce.date().nullable().optional(),
  clinicianSupported: z.boolean().optional(),
});
export type UpdateDiabetesProfileInput = z.infer<typeof updateDiabetesProfileSchema>;

export const recordSafetyFlagSchema = z.object({
  flag: safetyFlagSchema,
  status: safetyFlagStatusSchema,
  metadata: z.record(z.unknown()).optional(),
});
export type RecordSafetyFlagInput = z.infer<typeof recordSafetyFlagSchema>;

/**
 * The care mode implied by a diagnosis and the flags currently active.
 *
 * Derived rather than accepted, because care mode decides which analysis is
 * allowed to run. A browser that could send `careMode: 'type_2_standard'`
 * could ask a Type 1 user's data to be interpreted by detectors written for
 * somebody else's physiology.
 *
 * Insulin is the pivot for Type 2: it changes the risk, so it changes the
 * mode. Pregnancy outranks the recorded type, because a gestational context is
 * about what the body is doing now rather than what was diagnosed before.
 */
export function deriveCareMode(
  diabetesType: DiabetesType,
  activeFlags: readonly SafetyFlag[],
): CareMode {
  const has = (flag: SafetyFlag) => activeFlags.includes(flag);

  if (has('pregnancy')) return 'gestational';

  switch (diabetesType) {
    case 'type_1':
      return 'type_1_cgm_insulin';
    case 'gestational':
      return 'gestational';
    case 'prediabetes':
      return 'prediabetes';
    case 'other_specific':
      return 'other_specific';
    case 'type_2':
      return has('insulin_therapy') || has('pump_or_automated_insulin_delivery')
        ? 'type_2_insulin_supported'
        : 'type_2_standard';
    case 'unknown':
    default:
      return 'unknown';
  }
}

/**
 * How cautious the platform must be for this person right now.
 *
 * Computed on every read rather than stored. A stored tier drifts from the
 * flags it was derived from: someone records a pregnancy, the column still
 * says `standard`, and the safety service asks the column. The tier is the
 * input to decisions about whether a person may run an experiment unsupervised,
 * so it is the last value that should be allowed to go stale.
 *
 * Ordered by severity, and the most severe wins. Pregnancy is its own tier
 * rather than a kind of high risk, because the answer it changes is different:
 * high risk narrows what may be attempted, pregnancy changes who has to be
 * involved.
 */
export function deriveSafetyTier(
  careMode: CareMode,
  activeFlags: readonly SafetyFlag[],
): SafetyTier {
  const has = (flag: SafetyFlag) => activeFlags.includes(flag);

  if (careMode === 'gestational' || has('pregnancy')) return 'pregnancy';

  if (
    careMode === 'type_1_cgm_insulin' ||
    has('hypoglycemia_unawareness') ||
    has('history_of_severe_hypoglycemia') ||
    has('paediatric_user') ||
    has('pump_or_automated_insulin_delivery')
  ) {
    return 'high_risk';
  }

  if (
    careMode === 'other_specific' ||
    careMode === 'unknown' ||
    has('clinician_managed_protocol') ||
    has('kidney_disease')
  ) {
    return 'clinician_supported';
  }

  return 'standard';
}

/**
 * What the product will do for this person today.
 *
 * The honest answer for most care modes is "not yet". Saying so is the whole
 * point: a platform that silently fell back to Type 2 logic for a Type 1 user
 * would be producing confident findings from the wrong model of the body, and
 * the person reading them would have no way to tell.
 */
export const careModeCapabilitiesSchema = z.object({
  careMode: careModeSchema,
  safetyTier: safetyTierSchema,
  /** Whether the pattern engine may run at all for this person. */
  evidenceEnabled: z.boolean(),
  /** Whether self-serve experiments may be proposed without a clinician. */
  experimentsEnabled: z.boolean(),
  /** Shown when a surface is switched off, so the reason is never a blank screen. */
  unsupportedReason: z.string().nullable(),
});
export type CareModeCapabilities = z.infer<typeof careModeCapabilitiesSchema>;

/** Care modes whose detectors exist and have been checked. Everything else waits. */
const EVIDENCE_READY: readonly CareMode[] = ['type_2_standard', 'type_2_insulin_supported'];

export function careModeCapabilities(
  careMode: CareMode,
  activeFlags: readonly SafetyFlag[],
): CareModeCapabilities {
  const safetyTier = deriveSafetyTier(careMode, activeFlags);
  const evidenceEnabled = EVIDENCE_READY.includes(careMode);

  return {
    careMode,
    safetyTier,
    evidenceEnabled,
    // Experiments stay clinician-mediated above the standard tier regardless of
    // care mode. This mirrors classifyTemplate, which gates anything it does
    // not recognise rather than allowing it.
    experimentsEnabled: evidenceEnabled && safetyTier === 'standard',
    unsupportedReason: evidenceEnabled ? null : unsupportedReason(careMode),
  };
}

function unsupportedReason(careMode: CareMode): string {
  switch (careMode) {
    case 'unknown':
      return 'Wellovue needs to know what kind of diabetes you have before it can interpret your data. Until then it will not guess.';
    case 'prediabetes':
      return 'Wellovue currently produces evidence for Type 2 diabetes. Prediabetes detectors are being built and are not ready to be relied on.';
    case 'gestational':
      return 'Pregnancy changes what these numbers mean, and Wellovue does not yet produce findings for it. This is being built as a clinician-supported workflow.';
    case 'type_1_cgm_insulin':
      return 'Wellovue does not yet produce findings for Type 1 diabetes. The Type 2 analysis is built on a different model of the body and would be misleading here, so it is not used.';
    case 'other_specific':
      return 'This form of diabetes needs clinician-supported interpretation, which Wellovue does not yet provide.';
    default:
      return 'Wellovue does not yet produce findings for this care mode.';
  }
}
