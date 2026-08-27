import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVIDENCE_WINDOW_DAYS,
  MAX_EVIDENCE_WINDOW_DAYS,
  evidenceQuerySchema,
  findingStrength,
  orderFindings,
  type StructuredFinding,
} from '@wellovue/types';

const DAY_MS = 24 * 60 * 60 * 1000;

function finding(over: Partial<StructuredFinding> = {}): StructuredFinding {
  return {
    findingType: 'post_meal_response',
    summary: 'A summary the engine wrote.',
    effectEstimate: 1.2,
    effectUnit: 'mmol/L rise from baseline',
    confidence: 0.9,
    sampleCount: 40,
    limitations: ['Meal composition varies between meals'],
    clinicianReviewRecommended: false,
    wouldImproveWith: [],
    ...over,
  };
}

describe('evidenceQuerySchema', () => {
  it('defaults to a trailing window when no range is given', () => {
    const parsed = evidenceQuerySchema.parse({});
    const spanDays = (parsed.to.getTime() - parsed.from.getTime()) / DAY_MS;
    expect(Math.round(spanDays)).toBe(DEFAULT_EVIDENCE_WINDOW_DAYS);
  });

  it('accepts ISO strings from a query string', () => {
    const parsed = evidenceQuerySchema.parse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T00:00:00.000Z',
    });
    expect(parsed.from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(parsed.to.toISOString()).toBe('2026-07-31T00:00:00.000Z');
  });

  it('rejects a reversed or empty range', () => {
    const reversed = evidenceQuerySchema.safeParse({
      from: '2026-07-31T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(reversed.success).toBe(false);

    const empty = evidenceQuerySchema.safeParse({
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    });
    expect(empty.success).toBe(false);
  });

  it('refuses a window long enough to make one request cost arbitrarily much', () => {
    const to = new Date('2026-08-01T00:00:00.000Z');
    const justInside = new Date(to.getTime() - MAX_EVIDENCE_WINDOW_DAYS * DAY_MS);
    const justOutside = new Date(justInside.getTime() - DAY_MS);

    expect(evidenceQuerySchema.safeParse({ from: justInside, to }).success).toBe(true);
    expect(evidenceQuerySchema.safeParse({ from: justOutside, to }).success).toBe(false);
  });
});

describe('findingStrength', () => {
  it('reads strength from the sample and confidence when there is an estimate', () => {
    expect(findingStrength(finding({ sampleCount: 40, confidence: 0.9 }))).toBe('strong');
    expect(findingStrength(finding({ sampleCount: 12, confidence: 0.9 }))).toBe('moderate');
  });

  it('calls a finding with no effect estimate insufficient, whatever its sample count', () => {
    // The engine returns these when a comparison group is too thin. The count
    // describes what was logged, not what was measured, so scoring it as weak
    // evidence would claim a measurement that was never made.
    expect(
      findingStrength(finding({ effectEstimate: null, sampleCount: 500, confidence: 0 })),
    ).toBe('insufficient');
  });
});

describe('orderFindings', () => {
  it('puts supported findings first, firmest first', () => {
    const ordered = orderFindings([
      finding({ findingType: 'weak', sampleCount: 6, confidence: 0.4 }),
      finding({ findingType: 'unanswered', effectEstimate: null, sampleCount: 8 }),
      finding({ findingType: 'strong', sampleCount: 40, confidence: 0.9 }),
      finding({ findingType: 'moderate', sampleCount: 12, confidence: 0.9 }),
    ]);

    expect(ordered.map((f) => f.findingType)).toEqual([
      'strong',
      'moderate',
      'weak',
      'unanswered',
    ]);
  });

  it('breaks ties on the larger sample', () => {
    const ordered = orderFindings([
      finding({ findingType: 'fewer', sampleCount: 25, confidence: 0.9 }),
      finding({ findingType: 'more', sampleCount: 90, confidence: 0.9 }),
    ]);
    expect(ordered.map((f) => f.findingType)).toEqual(['more', 'fewer']);
  });

  it('does not mutate the engine response it was given', () => {
    const original = [
      finding({ findingType: 'weak', sampleCount: 6, confidence: 0.4 }),
      finding({ findingType: 'strong', sampleCount: 40, confidence: 0.9 }),
    ];
    orderFindings(original);
    expect(original.map((f) => f.findingType)).toEqual(['weak', 'strong']);
  });
});
