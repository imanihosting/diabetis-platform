import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EXPERIMENT_TEMPLATES,
  classifyTemplate,
  proposableTemplates,
  proposalFromFinding,
  type SafetyProfileContext,
} from '@wellovue/types';

const TYPE_2: SafetyProfileContext = { careMode: 'type_2_standard', safetyFlags: [] };

describe('proposing an experiment from a finding', () => {
  it('never offers a template outside the allowed set', () => {
    // The load-bearing test. This map is the only thing in the product that
    // turns a finding into a protocol, so if it could name a gated or blocked
    // template, a button on the evidence screen would be the thing surfacing
    // it. The classifier would still refuse, but the person would have been
    // offered something the product will not do.
    for (const template of proposableTemplates()) {
      expect(ALLOWED_EXPERIMENT_TEMPLATES as readonly string[]).toContain(template);
    }
  });

  it('proposes a runnable test for an ordinary Type 2 reader', () => {
    for (const template of proposableTemplates()) {
      expect(classifyTemplate(template, TYPE_2)).toBe('allowed');
    }
  });

  it('maps the findings a week of alternating behaviour could settle', () => {
    const walk = proposalFromFinding({
      findingType: 'post_meal_walk_effect',
      effectEstimate: -1.1,
    });
    expect(walk?.template).toBe('post_meal_walk');
    expect(walk?.protocol.days).toBe(6);

    expect(
      proposalFromFinding({ findingType: 'late_evening_meal_response', effectEstimate: 3 })
        ?.template,
    ).toBe('meal_timing');
    expect(
      proposalFromFinding({ findingType: 'post_meal_response', effectEstimate: 3 })
        ?.template,
    ).toBe('meal_order');
  });

  it('offers nothing for a finding no one-week test could settle', () => {
    // A morning average has no experiment a person can run alone in a week,
    // and an HbA1c trend moves over quarters. A button proposing one anyway
    // would look like the product knew what to do.
    for (const findingType of [
      'morning_glucose_pattern',
      'hba1c_trend',
      'weight_trend',
      'fasting_glucose_trend',
      'activity_consistency',
    ]) {
      expect(proposalFromFinding({ findingType, effectEstimate: 7 })).toBeNull();
    }
  });

  it('offers nothing when the detector measured nothing', () => {
    // "Not enough data" has not identified a question worth a week of
    // somebody's life, whatever the finding is called.
    expect(
      proposalFromFinding({ findingType: 'post_meal_walk_effect', effectEstimate: null }),
    ).toBeNull();
  });

  it('offers nothing for a refusal', () => {
    expect(
      proposalFromFinding({ findingType: 'care_mode_unsupported', effectEstimate: null }),
    ).toBeNull();
  });

  it('still defers to the care profile', () => {
    // Same finding, same template, different person. The map decides what is
    // worth testing; the classifier decides who may run it unsupervised.
    const template = proposalFromFinding({
      findingType: 'post_meal_walk_effect',
      effectEstimate: -1.1,
    })!.template;

    expect(classifyTemplate(template, TYPE_2)).toBe('allowed');
    expect(
      classifyTemplate(template, {
        careMode: 'type_2_standard',
        safetyFlags: ['pregnancy'],
      }),
    ).toBe('clinician_gated');
    expect(classifyTemplate(template, { careMode: 'unknown', safetyFlags: [] })).toBe(
      'clinician_gated',
    );
  });
});
