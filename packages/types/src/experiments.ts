import { z } from 'zod';
import { confidenceSchema, uuidSchema } from './common';
import { deriveSafetyTier, type CareMode, type SafetyFlag } from './diabetes';

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
 * Templates that stop being a gated conversation and become a refusal once
 * insulin is in the picture.
 *
 * Adjusting a dose near insulin should not be product-mediated at all. Under a
 * clinician it is ordinary care; inside an app that also draws charts about
 * your glucose, it is an instruction wearing the clothes of an experiment.
 *
 * Timing is deliberately not here. Moving a dose earlier or later is a real
 * question a clinician can supervise, and blocking it would push the
 * conversation out of the product rather than into the right place.
 */
export const INSULIN_BLOCKED_TEMPLATES = ['medication_dose'] as const;

/**
 * Care modes where a person may start an experiment without a clinician.
 *
 * Everything else is gated at minimum, including care modes whose detectors do
 * not exist yet. Not knowing what kind of diabetes someone has is not a reason
 * to let them run an unsupervised protocol; it is the reason not to.
 */
const SELF_SERVE_CARE_MODES: readonly CareMode[] = [
  'type_2_standard',
  'type_2_insulin_supported',
  'prediabetes',
];

/**
 * The care context a safety decision needs.
 *
 * Required, not optional, and there is deliberately no second entry point that
 * omits it. A classifier with a permissive default is one forgotten argument
 * away from allowing something it was written to stop, and a safety function
 * with two ways in will eventually be called through the wrong one. This
 * mirrors `careMode` on `PatternRequest`: supply the context or fail before
 * runtime.
 *
 * `safetyFlags` holds the flags **currently in force**, not the stored
 * history. The rows in `clinical.diabetes_safety_flags` are append-only, so a
 * resolved flag still has the row that raised it, and anything filtering that
 * history on `status === 'active'` resurrects flags that ended. Deriving
 * "currently in force" happens once, in SQL, and its result is what belongs
 * here — the same value `DiabetesContext.activeFlags` carries and the same one
 * the engine receives.
 */
export interface SafetyProfileContext {
  careMode: CareMode;
  safetyFlags: readonly SafetyFlag[];
}

function insulinIsInvolved(context: SafetyProfileContext): boolean {
  return (
    context.careMode === 'type_2_insulin_supported' ||
    context.careMode === 'type_1_cgm_insulin' ||
    context.safetyFlags.includes('insulin_therapy') ||
    context.safetyFlags.includes('pump_or_automated_insulin_delivery')
  );
}

/** Ordered by severity, so a decision can only ever be tightened. */
const SEVERITY: Record<SafetyStatus, number> = {
  allowed: 0,
  clinician_gated: 1,
  blocked: 2,
};

function atLeast(current: SafetyStatus, floor: SafetyStatus): SafetyStatus {
  return SEVERITY[floor] > SEVERITY[current] ? floor : current;
}

/**
 * Single source of truth for experiment safety. The API enforces this before
 * writing, and the database enforces the resulting invariants again.
 *
 * Every rule below can only make the answer stricter. That is what makes the
 * function safe to extend: a new condition can withdraw a permission and can
 * never grant one, so no future clause can accidentally unblock insulin
 * dosing.
 *
 * Note that nothing calls this yet — there is no experiments endpoint. It is
 * the contract the database's check constraints mirror, and it exists now so
 * that experiment work starts from the right safety primitive rather than
 * retrofitting one.
 */
export function classifyTemplate(
  template: string,
  context: SafetyProfileContext,
): SafetyStatus {
  return classify(template, context).status;
}

/**
 * The classification and why it came out that way.
 *
 * Internal, so `classifyTemplate` keeps the signature its tests are written
 * against while the endpoint gets the reason too. One computation with two
 * views rather than two functions that can disagree about the same request —
 * which, for a safety decision and the sentence explaining it, is the pair
 * least able to afford disagreeing.
 */
interface Classification {
  status: SafetyStatus;
  reason: string;
}

const BLOCKED_REASONS: Record<string, string> = {
  insulin_dosing:
    'Wellovue cannot create experiments that involve insulin dosing. This is not a limitation of the software; it is a line the product does not cross.',
  medication_discontinuation:
    'Stopping a medication is a clinical decision, and never one Wellovue will help you plan.',
  hypoglycemia_treatment:
    'Treating a hypo is urgent care. Wellovue is not the place for it, and following a plan written in an app would cost time you may not have.',
  hyperglycemia_treatment:
    'Treating a hyper is urgent care, and belongs with the people who can see more than your records.',
  emergency_triage:
    'Wellovue cannot help in an emergency. Contact your clinician or emergency services.',
};

function classify(template: string, context: SafetyProfileContext): Classification {
  let status: SafetyStatus;
  let reason: string;

  if ((BLOCKED_TEMPLATES as readonly string[]).includes(template)) {
    status = 'blocked';
    reason =
      BLOCKED_REASONS[template] ??
      'Wellovue will never help plan this kind of change.';
  } else if ((CLINICIAN_GATED_TEMPLATES as readonly string[]).includes(template)) {
    status = 'clinician_gated';
    reason = 'This needs a clinician to look at it before it can start.';
  } else if ((ALLOWED_EXPERIMENT_TEMPLATES as readonly string[]).includes(template)) {
    status = 'allowed';
    reason = 'You can start this whenever you like.';
  } else {
    // An unrecognised template is gated, never silently allowed.
    status = 'clinician_gated';
    reason =
      'Wellovue does not recognise this kind of experiment, so it cannot judge whether it is safe to run unsupervised.';
  }

  if (
    insulinIsInvolved(context) &&
    (INSULIN_BLOCKED_TEMPLATES as readonly string[]).includes(template)
  ) {
    if (SEVERITY.blocked > SEVERITY[status]) {
      reason =
        'Changing a dose while insulin is in the picture is not something Wellovue will help plan. Under a clinician it is ordinary care; here it would be an instruction dressed as an experiment.';
    }
    status = atLeast(status, 'blocked');
  }

  if (!SELF_SERVE_CARE_MODES.includes(context.careMode)) {
    if (SEVERITY.clinician_gated > SEVERITY[status]) {
      reason =
        'Wellovue does not yet know enough about your kind of diabetes to say this is safe to run on your own.';
    }
    status = atLeast(status, 'clinician_gated');
  }

  // Above the standard tier nothing runs unsupervised, whatever the template.
  // Pregnancy and a history of severe hypoglycaemia change who has to be
  // involved, not merely how carefully.
  if (deriveSafetyTier(context.careMode, context.safetyFlags) !== 'standard') {
    if (SEVERITY.clinician_gated > SEVERITY[status]) {
      reason =
        'Your care profile puts this in the group that a clinician should agree to first.';
    }
    status = atLeast(status, 'clinician_gated');
  }

  return { status, reason };
}

export const experimentDecisionSchema = z.object({
  status: safetyStatusSchema,
  reason: z.string(),
  /** Whether the person may begin it now, without anyone else's involvement. */
  canStart: z.boolean(),
});
export type ExperimentDecision = z.infer<typeof experimentDecisionSchema>;

/**
 * The safety decision, and everything that follows from it.
 *
 * The persisted status and the review flag are derived here rather than
 * accepted from a request, for the reason `careMode` is: the browser supplies
 * the question, the server supplies the safety answer. Sending
 * `clinicianReviewRequired: false` alongside a gated template would otherwise
 * reach the database and come back as a constraint violation, which is a 500
 * dressed as a validation error.
 *
 * A blocked experiment is still recorded, as a draft that can never start.
 * Refusing with a 400 would treat it as malformed input, and blocked insulin
 * dosing is not malformed: it is a real question the product must decline. The
 * record of what was asked, when, and why it was refused is worth keeping.
 */
export function experimentDecision(
  template: string,
  context: SafetyProfileContext,
): ExperimentDecision & {
  experimentStatus: ExperimentStatus;
  clinicianReviewRequired: boolean;
} {
  const { status, reason } = classify(template, context);

  return {
    status,
    reason,
    canStart: status === 'allowed',
    // `awaiting_review` rather than `draft` for a gated experiment: it is
    // waiting on somebody, and a draft implies it is waiting on you.
    experimentStatus: status === 'clinician_gated' ? 'awaiting_review' : 'draft',
    // The database's `experiments_gate_chk` requires exactly this pairing.
    // Deriving it here means the two cannot disagree.
    clinicianReviewRequired: status === 'clinician_gated',
  };
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
