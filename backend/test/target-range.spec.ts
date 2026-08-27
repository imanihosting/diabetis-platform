import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  glucoseZone,
  isInTargetRange,
  TARGET_HIGH_MMOL,
  TARGET_LOW_MMOL,
} from '@wellovue/types';

describe('target range', () => {
  it('classifies a reading by which side of the range it falls', () => {
    expect(glucoseZone(3.2)).toBe('below');
    expect(glucoseZone(6.4)).toBe('in');
    expect(glucoseZone(14.7)).toBe('above');
  });

  it('treats both bounds as inclusive', () => {
    // The boundary is where a disagreement would hide: `>=` against `>` looks
    // identical on every reading except the two a person is most likely to be
    // staring at when the answer matters.
    expect(glucoseZone(TARGET_LOW_MMOL)).toBe('in');
    expect(glucoseZone(TARGET_HIGH_MMOL)).toBe('in');
    expect(isInTargetRange(TARGET_LOW_MMOL)).toBe(true);
    expect(isInTargetRange(TARGET_HIGH_MMOL)).toBe(true);

    // And that the bounds are exclusive on the far side of themselves.
    expect(glucoseZone(TARGET_LOW_MMOL - 0.1)).toBe('below');
    expect(glucoseZone(TARGET_HIGH_MMOL + 0.1)).toBe('above');
  });

  it('puts every reading in exactly one zone', () => {
    // No gap and no overlap: the three counts in a glucose summary have to add
    // up to the sample count, or a time-in-range percentage is quietly wrong.
    for (let mmol = 1; mmol <= 25; mmol += 0.1) {
      const zone = glucoseZone(Number(mmol.toFixed(1)));
      expect(['below', 'in', 'above']).toContain(zone);
    }
  });
});

/**
 * The engine keeps its own copy of these two numbers because Python cannot
 * import TypeScript. This is what stops that copy drifting.
 *
 * Reading the file rather than running Python: the two numbers are the whole
 * contract, and a test that needed an interpreter to check them would be
 * skipped on the first machine that lacked one.
 */
describe('metabolic engine agreement', () => {
  const thresholds = readFileSync(
    join(__dirname, '..', '..', 'metabolic-engine', 'app', 'engines', 'thresholds.py'),
    'utf8',
  );

  const declared = (name: string): number => {
    // Anchored to the start of a line so a mention inside a comment cannot be
    // mistaken for the declaration.
    const match = thresholds.match(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, 'm'));
    if (!match) throw new Error(`${name} is not declared in thresholds.py`);
    return Number(match[1]);
  };

  it('uses the same target range as the shared contract', () => {
    expect(declared('TARGET_LOW_MMOL')).toBe(TARGET_LOW_MMOL);
    expect(declared('TARGET_HIGH_MMOL')).toBe(TARGET_HIGH_MMOL);
  });

  it('names the contract as the source rather than claiming to be it', () => {
    // A number that agrees today and does not say why will be edited by
    // somebody who has no reason to look for the other copy.
    expect(thresholds).toContain('packages/types/src/glucose.ts');
  });
});
