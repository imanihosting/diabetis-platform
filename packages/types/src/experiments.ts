import { z } from 'zod';
import { confidenceSchema, uuidSchema } from './common';

/**
 * Safety classification for self-experiments.
 * See docs/technical-architecture.md, "Safety Boundaries".
 */
export const safetyStatusSchema = z.enum([
  'allowed',
  'clinician_gated',
  'blocked',
]);
export type SafetyStatus = z.infer<typeof safetyStatusSchema>;

export const experimentStatusSchema = z.enum([
  'draft',
  'awaiting_review',
  'active',
  'completed',
  'abandoned',
]);
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;

/** Experiment templates a user may start without clinician sign-off. */
export const ALLOWED_EXPERIMENT_TEMPLATES = [
  'meal_timing',
  'post_meal_walk',
  'sleep_observation',
  'hydration_logging',
  'portion_comparison',
  'meal_order',
  'stress_tagging',
] as const;

/** Templates that require a clinician to approve before they can run. */
export const CLINICIAN_GATED_TEMPLATES = [
  'medication_timing',
  'medication_dose',
  'fasting_protocol',
  'major_diet_change',
  'exercise_change_high_risk',
] as const;

/** Never available in-app under any circumstances. */
export const BLOCKED_TEMPLATES = [
  'hypoglycemia_treatment',
  'hyperglycemia_treatment',
  'insulin_dosing',
  'emergency_triage',
  'medication_discontinuation',
] as const;

export type ExperimentTemplate =
  | (typeof ALLOWED_EXPERIMENT_TEMPLATES)[number]
  | (typeof CLINICIAN_GATED_TEMPLATES)[number]
  | (typeof BLOCKED_TEMPLATES)[number];

/**
 * Single source of truth for experiment safety. The API enforces this before
 * writing, and the database enforces the resulting invariants again.
 */
export function classifyTemplate(template: string): SafetyStatus {
  if ((BLOCKED_TEMPLATES as readonly string[]).includes(template)) return 'blocked';
  if ((CLINICIAN_GATED_TEMPLATES as readonly string[]).includes(template)) {
    return 'clinician_gated';
  }
  if ((ALLOWED_EXPERIMENT_TEMPLATES as readonly string[]).includes(template)) {
    return 'allowed';
  }
  // An unrecognised template is gated, never silently allowed.
  return 'clinician_gated';
}

export const hypothesisSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  hypothesisType: z.string(),
  statement: z.string(),
  priorProbability: confidenceSchema.nullable(),
  currentProbability: confidenceSchema.nullable(),
  status: z.enum(['open', 'testing', 'supported', 'refuted', 'abandoned']),
  evidenceSummary: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

export const createExperimentSchema = z.object({
  hypothesisId: uuidSchema.optional(),
  template: z.string().min(1),
  title: z.string().min(1).max(200),
  question: z.string().min(1).max(1000),
  protocol: z.record(z.unknown()),
});
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;

export const experimentSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  hypothesisId: uuidSchema.nullable(),
  title: z.string(),
  question: z.string(),
  protocol: z.record(z.unknown()),
  safetyStatus: safetyStatusSchema,
  clinicianReviewRequired: z.boolean(),
  status: experimentStatusSchema,
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Experiment = z.infer<typeof experimentSchema>;
