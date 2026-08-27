import { describe, expect, it } from 'vitest';
import {
  careModeCapabilities,
  profileNeedsSetup,
  careModeSchema,
  deriveCareMode,
  deriveSafetyTier,
  diabetesProfileSchema,
  recordSafetyFlagSchema,
  updateDiabetesProfileSchema,
  type CareMode,
  type SafetyFlag,
} from '@wellovue/types';

describe('deriveCareMode', () => {
  it('separates Type 2 with insulin from Type 2 without it', () => {
    // The distinction the whole profile layer exists for: same diagnosis,
    // different hypoglycaemia risk, so different safety posture.
    expect(deriveCareMode('type_2', [])).toBe('type_2_standard');
    expect(deriveCareMode('type_2', ['insulin_therapy'])).toBe('type_2_insulin_supported');
    expect(deriveCareMode('type_2', ['pump_or_automated_insulin_delivery'])).toBe(
      'type_2_insulin_supported',
    );
  });

  it('lets pregnancy outrank the recorded diagnosis', () => {
    // Gestational context is about what the body is doing now, not what was
    // written down before.
    expect(deriveCareMode('type_2', ['pregnancy'])).toBe('gestational');
    expect(deriveCareMode('type_1', ['pregnancy'])).toBe('gestational');
    expect(deriveCareMode('prediabetes', ['pregnancy'])).toBe('gestational');
  });

  it('maps an unknown diagnosis to an unknown care mode', () => {
    expect(deriveCareMode('unknown', [])).toBe('unknown');
    expect(deriveCareMode('unknown', ['insulin_therapy'])).toBe('unknown');
  });
});

describe('deriveSafetyTier', () => {
  it('returns the most severe tier the flags support', () => {
    expect(deriveSafetyTier('type_2_standard', [])).toBe('standard');
    expect(deriveSafetyTier('type_2_standard', ['kidney_disease'])).toBe(
      'clinician_supported',
    );
    expect(deriveSafetyTier('type_2_standard', ['hypoglycemia_unawareness'])).toBe(
      'high_risk',
    );
    expect(deriveSafetyTier('type_2_standard', ['pregnancy'])).toBe('pregnancy');
  });

  it('cannot be dragged down by a milder flag alongside a severe one', () => {
    // Order of the flags must not decide the answer.
    const flags: SafetyFlag[] = ['kidney_disease', 'pregnancy', 'cardiovascular_risk'];
    expect(deriveSafetyTier('type_2_standard', flags)).toBe('pregnancy');
    expect(deriveSafetyTier('type_2_standard', [...flags].reverse())).toBe('pregnancy');
  });

  it('treats an unknown care mode as needing a clinician, not as standard', () => {
    // Failing closed. Knowing nothing is not the same as knowing it is fine.
    expect(deriveSafetyTier('unknown', [])).toBe('clinician_supported');
  });

  it('never returns standard for Type 1', () => {
    expect(deriveSafetyTier('type_1_cgm_insulin', [])).toBe('high_risk');
  });
});

describe('careModeCapabilities', () => {
  it('enables evidence only for the care modes with reviewed detectors', () => {
    expect(careModeCapabilities('type_2_standard', []).evidenceEnabled).toBe(true);
    expect(careModeCapabilities('type_2_insulin_supported', []).evidenceEnabled).toBe(
      true,
    );
  });

  it('refuses to analyse every care mode the engine was not written for', () => {
    // The failure this guards against is silent: Type 2 detectors would happily
    // return confident findings for a Type 1 record, computed from the wrong
    // model of the body, and nothing on the page would say so.
    const unsupported: CareMode[] = [
      'unknown',
      'prediabetes',
      'gestational',
      'type_1_cgm_insulin',
      'other_specific',
    ];
    for (const mode of unsupported) {
      const caps = careModeCapabilities(mode, []);
      expect(caps.evidenceEnabled).toBe(false);
      // A switched-off surface must always be able to say why.
      expect(caps.unsupportedReason).toBeTruthy();
      expect(caps.experimentsEnabled).toBe(false);
    }
  });

  it('withdraws self-serve experiments above the standard tier', () => {
    const pregnant = careModeCapabilities('type_2_standard', ['pregnancy']);
    expect(pregnant.experimentsEnabled).toBe(false);

    const highRisk = careModeCapabilities('type_2_standard', [
      'history_of_severe_hypoglycemia',
    ]);
    expect(highRisk.experimentsEnabled).toBe(false);
  });

  it('covers every care mode in the enum', () => {
    // A mode added to the contract without a capability decision would
    // otherwise fall through to whatever the default happens to be.
    for (const mode of careModeSchema.options) {
      expect(() => careModeCapabilities(mode, [])).not.toThrow();
    }
  });
});

describe('profileNeedsSetup', () => {
  it('is true only when nobody has answered', () => {
    expect(profileNeedsSetup({ diagnosisSource: 'unanswered' })).toBe(true);
  });

  it('is false once someone answers, even if the answer is "not sure"', () => {
    // Answering "I am not sure" is a real answer. Treating it as unanswered
    // would prompt the same person for the same thing on every visit, which is
    // nagging rather than care.
    expect(profileNeedsSetup({ diagnosisSource: 'self_reported' })).toBe(false);
  });

  it('is false for the accounts backfilled before the question existed', () => {
    // They cannot be asked retroactively, and prompting them would imply they
    // had skipped something they were never offered.
    expect(profileNeedsSetup({ diagnosisSource: 'assumed' })).toBe(false);
  });
});

describe('profile input validation', () => {
  it('will not accept a care mode from the client', () => {
    // Care mode decides which analysis runs, so it is derived on the server.
    // The schema strips it rather than trusting it.
    const parsed = updateDiabetesProfileSchema.parse({
      diabetesType: 'type_1',
      careMode: 'type_2_standard',
    } as Record<string, unknown>);
    expect('careMode' in parsed).toBe(false);
  });

  it('rejects a diagnosis outside the agreed set', () => {
    expect(
      updateDiabetesProfileSchema.safeParse({ diabetesType: 'type_3' }).success,
    ).toBe(false);
  });

  it('rejects an unrecognised safety flag', () => {
    expect(
      recordSafetyFlagSchema.safeParse({ flag: 'made_up_flag', status: 'active' })
        .success,
    ).toBe(false);
    expect(
      recordSafetyFlagSchema.safeParse({ flag: 'pregnancy', status: 'maybe' }).success,
    ).toBe(false);
    expect(
      recordSafetyFlagSchema.safeParse({ flag: 'pregnancy', status: 'active' }).success,
    ).toBe(true);
  });

  it('accepts a profile row shaped as the database returns it', () => {
    const parsed = diabetesProfileSchema.safeParse({
      userId: '11111111-1111-4111-8111-111111111111',
      diabetesType: 'type_2',
      careMode: 'type_2_standard',
      diagnosedOn: null,
      diagnosisSource: 'assumed',
      clinicianSupported: false,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });
});
