import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EXPERIMENT_TEMPLATES,
  BLOCKED_TEMPLATES,
  CLINICIAN_GATED_TEMPLATES,
  classifyTemplate,
  evidenceStrength,
  requiresInsulinBoundary,
  toMgDl,
  toMmolL,
  type SafetyProfileContext,
} from '@wellovue/types';

/**
 * The context every classification below is made in.
 *
 * Written out rather than defaulted. `classifyTemplate` takes it as a required
 * argument precisely so a safety decision cannot be made without saying whose
 * it is, and a test helper that hid it again would put back the call form the
 * signature exists to remove.
 */
const TYPE_2_NO_FLAGS: SafetyProfileContext = {
  careMode: 'type_2_standard',
  safetyFlags: [],
};

const TYPE_2_ON_INSULIN: SafetyProfileContext = {
  careMode: 'type_2_insulin_supported',
  safetyFlags: ['insulin_therapy'],
};

describe('experiment safety classification', () => {
  // These first five are the original suite, unchanged in meaning: the same
  // templates, the same expected answers, now stated for a Type 2 record with
  // no flags rather than for an unnamed nobody.
  it('classifies every allowed template as allowed', () => {
    for (const template of ALLOWED_EXPERIMENT_TEMPLATES) {
      expect(classifyTemplate(template, TYPE_2_NO_FLAGS)).toBe('allowed');
    }
  });

  it('classifies every gated template as clinician_gated', () => {
    for (const template of CLINICIAN_GATED_TEMPLATES) {
      expect(classifyTemplate(template, TYPE_2_NO_FLAGS)).toBe('clinician_gated');
    }
  });

  it('classifies every blocked template as blocked', () => {
    for (const template of BLOCKED_TEMPLATES) {
      expect(classifyTemplate(template, TYPE_2_NO_FLAGS)).toBe('blocked');
    }
  });

  it('gates an unrecognised template rather than allowing it', () => {
    // Failing closed matters here: a template nobody classified must not
    // become a self-experiment a patient can start unsupervised.
    expect(classifyTemplate('some_new_untriaged_protocol', TYPE_2_NO_FLAGS)).toBe(
      'clinician_gated',
    );
    expect(classifyTemplate('', TYPE_2_NO_FLAGS)).toBe('clinician_gated');
  });

  it('never classifies insulin dosing or emergency treatment as runnable', () => {
    for (const template of [
      'insulin_dosing',
      'hypoglycemia_treatment',
      'hyperglycemia_treatment',
      'emergency_triage',
      'medication_discontinuation',
    ]) {
      expect(classifyTemplate(template, TYPE_2_NO_FLAGS)).toBe('blocked');
    }
  });
});

describe('the same template, classified for two different people', () => {
  // The whole point of the profile argument. Nothing about the template
  // changes between these; only whose record it would run against.

  it('blocks a dose experiment once insulin is involved, and gates it otherwise', () => {
    // Adjusting a dose near insulin should not be product-mediated at all.
    // Under a clinician it is ordinary care; inside an app that also draws
    // charts about your glucose it is an instruction dressed as an experiment.
    expect(classifyTemplate('medication_dose', TYPE_2_NO_FLAGS)).toBe(
      'clinician_gated',
    );
    expect(classifyTemplate('medication_dose', TYPE_2_ON_INSULIN)).toBe('blocked');
  });

  it('finds insulin through the flag as well as the care mode', () => {
    // Someone recorded as plain Type 2 who has ticked "I take insulin" is on
    // insulin. The care mode derivation would normally move them, and this
    // does not depend on it having.
    expect(
      classifyTemplate('medication_dose', {
        careMode: 'type_2_standard',
        safetyFlags: ['insulin_therapy'],
      }),
    ).toBe('blocked');

    expect(
      classifyTemplate('medication_dose', {
        careMode: 'type_2_standard',
        safetyFlags: ['pump_or_automated_insulin_delivery'],
      }),
    ).toBe('blocked');
  });

  it('keeps medication timing a gated conversation rather than a refusal', () => {
    // Moving a dose earlier or later is a real question a clinician can
    // supervise. Blocking it pushes that conversation out of the product
    // instead of into the right place.
    expect(classifyTemplate('medication_timing', TYPE_2_ON_INSULIN)).toBe(
      'clinician_gated',
    );
  });

  it('still refuses insulin dosing and discontinuation for everyone', () => {
    for (const context of [TYPE_2_NO_FLAGS, TYPE_2_ON_INSULIN]) {
      expect(classifyTemplate('insulin_dosing', context)).toBe('blocked');
      expect(classifyTemplate('medication_discontinuation', context)).toBe('blocked');
    }
  });

  it('leaves the ordinary experiments open to someone on insulin', () => {
    // Over-gating would make the product useless to the group that most needs
    // it. Walking after a meal and recording what happened is not a dose
    // decision, and `exercise_change_high_risk` already covers the case that
    // is.
    expect(classifyTemplate('post_meal_walk', TYPE_2_ON_INSULIN)).toBe('allowed');
    expect(classifyTemplate('meal_timing', TYPE_2_ON_INSULIN)).toBe('allowed');
  });
});

describe('care modes that have to fail closed', () => {
  it('lets nothing run unsupervised when the diabetes is unknown', () => {
    // Not knowing what kind of diabetes somebody has is not a reason to let
    // them start an unsupervised protocol. It is the reason not to.
    for (const template of ALLOWED_EXPERIMENT_TEMPLATES) {
      expect(
        classifyTemplate(template, { careMode: 'unknown', safetyFlags: [] }),
      ).toBe('clinician_gated');
    }
  });

  it('gates every care mode whose detectors do not exist yet', () => {
    for (const careMode of ['gestational', 'type_1_cgm_insulin', 'other_specific'] as const) {
      expect(
        classifyTemplate('post_meal_walk', { careMode, safetyFlags: [] }),
      ).toBe('clinician_gated');
    }
  });

  it('gates everything above the standard safety tier', () => {
    // Pregnancy and a history of severe hypoglycaemia change who has to be
    // involved, not merely how carefully.
    expect(
      classifyTemplate('post_meal_walk', {
        careMode: 'type_2_standard',
        safetyFlags: ['pregnancy'],
      }),
    ).toBe('clinician_gated');

    expect(
      classifyTemplate('post_meal_walk', {
        careMode: 'type_2_standard',
        safetyFlags: ['history_of_severe_hypoglycemia'],
      }),
    ).toBe('clinician_gated');
  });

  it('can only ever tighten, never loosen', () => {
    // Every rule in the classifier raises the floor. A blocked template stays
    // blocked whatever context arrives, so no clause added later can
    // accidentally unblock insulin dosing.
    const contexts: SafetyProfileContext[] = [
      TYPE_2_NO_FLAGS,
      TYPE_2_ON_INSULIN,
      { careMode: 'unknown', safetyFlags: [] },
      { careMode: 'prediabetes', safetyFlags: ['kidney_disease'] },
      { careMode: 'gestational', safetyFlags: ['pregnancy'] },
    ];
    for (const context of contexts) {
      for (const template of BLOCKED_TEMPLATES) {
        expect(classifyTemplate(template, context)).toBe('blocked');
      }
      for (const template of CLINICIAN_GATED_TEMPLATES) {
        expect(classifyTemplate(template, context)).not.toBe('allowed');
      }
    }
  });
});

describe('requiresInsulinBoundary', () => {
  it('applies wherever insulin is involved, by mode or by flag', () => {
    expect(requiresInsulinBoundary('type_2_insulin_supported', [])).toBe(true);
    expect(requiresInsulinBoundary('type_1_cgm_insulin', [])).toBe(true);
    expect(requiresInsulinBoundary('type_2_standard', ['insulin_therapy'])).toBe(true);
    expect(
      requiresInsulinBoundary('type_2_standard', ['pump_or_automated_insulin_delivery']),
    ).toBe(true);
  });

  it('stays off a screen it does not belong on', () => {
    // A boundary that appears everywhere is read nowhere.
    expect(requiresInsulinBoundary('type_2_standard', [])).toBe(false);
    expect(requiresInsulinBoundary('prediabetes', ['kidney_disease'])).toBe(false);
  });
});

describe('evidenceStrength', () => {
  it('calls a thin sample insufficient regardless of model confidence', () => {
    expect(evidenceStrength(4, 0.99)).toBe('insufficient');
    expect(evidenceStrength(0, 1)).toBe('insufficient');
  });

  it('never reports strong evidence on low confidence', () => {
    expect(evidenceStrength(500, 0.5)).toBe('weak');
    expect(evidenceStrength(500, 0.7)).toBe('moderate');
  });

  it('requires both a large sample and high confidence for strong', () => {
    expect(evidenceStrength(20, 0.8)).toBe('strong');
    expect(evidenceStrength(19, 0.8)).toBe('moderate');
    expect(evidenceStrength(20, 0.79)).toBe('moderate');
  });
});

describe('glucose unit conversion', () => {
  it('round-trips without drift', () => {
    const original = 7.8;
    expect(toMmolL(toMgDl(original, 'mmol/L'), 'mg/dL')).toBeCloseTo(original, 6);
  });

  it('leaves a value alone when it is already in the target unit', () => {
    expect(toMmolL(7.8, 'mmol/L')).toBe(7.8);
    expect(toMgDl(140, 'mg/dL')).toBe(140);
  });

  it('converts a familiar clinical value correctly', () => {
    expect(toMgDl(7.0, 'mmol/L')).toBeCloseTo(126.1, 1);
  });
});
