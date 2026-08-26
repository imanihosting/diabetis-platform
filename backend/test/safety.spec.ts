import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EXPERIMENT_TEMPLATES,
  BLOCKED_TEMPLATES,
  CLINICIAN_GATED_TEMPLATES,
  classifyTemplate,
  evidenceStrength,
  toMgDl,
  toMmolL,
} from '@diabetes/types';

describe('experiment safety classification', () => {
  it('classifies every allowed template as allowed', () => {
    for (const template of ALLOWED_EXPERIMENT_TEMPLATES) {
      expect(classifyTemplate(template)).toBe('allowed');
    }
  });

  it('classifies every gated template as clinician_gated', () => {
    for (const template of CLINICIAN_GATED_TEMPLATES) {
      expect(classifyTemplate(template)).toBe('clinician_gated');
    }
  });

  it('classifies every blocked template as blocked', () => {
    for (const template of BLOCKED_TEMPLATES) {
      expect(classifyTemplate(template)).toBe('blocked');
    }
  });

  it('gates an unrecognised template rather than allowing it', () => {
    // Failing closed matters here: a template nobody classified must not
    // become a self-experiment a patient can start unsupervised.
    expect(classifyTemplate('some_new_untriaged_protocol')).toBe('clinician_gated');
    expect(classifyTemplate('')).toBe('clinician_gated');
  });

  it('never classifies insulin dosing or emergency treatment as runnable', () => {
    for (const template of [
      'insulin_dosing',
      'hypoglycemia_treatment',
      'hyperglycemia_treatment',
      'emergency_triage',
      'medication_discontinuation',
    ]) {
      expect(classifyTemplate(template)).toBe('blocked');
    }
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
