import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_FOR_MODERATE,
  COVERAGE_FOR_STRONG,
  COVERAGE_FOR_WEAK,
  POST_MEAL_WINDOW_MINUTES,
  dataQualitySchema,
  evidenceStrength,
  groupMeasureSchema,
  knownPostMealShapes,
  postMealMetricsSchema,
  postMealShapeLabel,
  structuredFindingSchema,
} from '@wellovue/types';

/**
 * The post-meal measurements, where the two halves of the contract meet.
 *
 * `PostMealMetrics` exists twice — in `metabolic-engine/app/models/findings.py`
 * and in `packages/types/src/insights.ts` — because Python cannot import
 * TypeScript. That duplication is only safe if something fails when the two
 * drift, and the specific way they drift is silent: zod strips a key it does
 * not know, so an engine field the contract has never heard of does not throw
 * anywhere. It simply never reaches the screen.
 *
 * These read the Python source rather than running it, for the same reason
 * `target-range.spec.ts` does: a check that needs an interpreter is a check
 * that gets skipped on the first machine without one.
 */

const engineSource = (file: string): string =>
  readFileSync(
    join(__dirname, '..', '..', 'metabolic-engine', 'app', file),
    'utf8',
  );

const FINDINGS = engineSource(join('models', 'findings.py'));
const POST_MEAL = engineSource(join('engines', 'post_meal.py'));

/** The class body, so a field on a neighbouring model cannot be counted here. */
function classBody(source: string, name: string): string {
  const start = source.indexOf(`class ${name}(BaseModel):`);
  expect(start, `${name} is not declared in findings.py`).toBeGreaterThan(-1);
  const next = source.indexOf('\nclass ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('post-meal metrics contract', () => {
  it('sends every field under the name the contract reads', () => {
    const body = classBody(FINDINGS, 'PostMealMetrics');

    // Fields that cross the wire under a different name declare it; `n` and
    // `shape` are already the same word in both languages.
    const aliased = [...body.matchAll(/serialization_alias="([A-Za-z]+)"/g)].map(
      (m) => m[1],
    );
    const plain = [...body.matchAll(/^ {4}(n|shape): /gm)].map((m) => m[1]);
    const engineFields = new Set([...aliased, ...plain]);

    expect(engineFields).toEqual(new Set(Object.keys(postMealMetricsSchema.shape)));
  });

  it('measures over the same window the engine does', () => {
    // A third copy of a number that lives in thresholds.py, and the reason it
    // exists in TypeScript at all: the packet and the evidence page both say
    // "still above at 2 hours", which is this constant spelled out. A surface
    // hard-coding the words while the engine moves the window is a surface
    // that lies to a clinician.
    const thresholds = readFileSync(
      join(__dirname, '..', '..', 'metabolic-engine', 'app', 'engines', 'thresholds.py'),
      'utf8',
    );
    const declared = thresholds.match(/^POST_MEAL_WINDOW_MINUTES\s*=\s*([0-9]+)/m);
    expect(declared, 'POST_MEAL_WINDOW_MINUTES is not declared in thresholds.py').toBeTruthy();
    expect(Number(declared![1])).toBe(POST_MEAL_WINDOW_MINUTES);
  });

  it('accepts a payload shaped the way the engine serialises one', () => {
    const parsed = postMealMetricsSchema.parse({
      n: 18,
      timeToPeakMinutes: 60,
      minutesAboveRange: 57.5,
      returnToRangeMinutes: 95,
      areaAboveRange: 61.2,
      stillAboveAtWindowEnd: 0,
      shape: 'rose_and_returned',
    });

    expect(parsed.minutesAboveRange).toBe(57.5);
    expect(parsed.returnToRangeMinutes).toBe(95);
  });

  it('carries a null return time rather than rejecting it', () => {
    // Two different meanings, both legitimate: nothing went above target, or
    // nothing came back before the window closed. The engine distinguishes
    // them with the other fields, and the contract must let both through.
    const neverLeft = postMealMetricsSchema.parse({
      n: 9,
      timeToPeakMinutes: 45,
      minutesAboveRange: 0,
      returnToRangeMinutes: null,
      areaAboveRange: 0,
      stillAboveAtWindowEnd: 0,
      shape: 'flat',
    });
    expect(neverLeft.returnToRangeMinutes).toBeNull();

    const neverReturned = postMealMetricsSchema.parse({
      n: 9,
      timeToPeakMinutes: 90,
      minutesAboveRange: 97.5,
      returnToRangeMinutes: null,
      areaAboveRange: 176.2,
      stillAboveAtWindowEnd: 9,
      shape: 'prolonged',
    });
    expect(neverReturned.stillAboveAtWindowEnd).toBe(9);
  });

  it('declares the field on the group under the name the engine sends', () => {
    const group = classBody(FINDINGS, 'GroupMeasure');
    expect(group).toContain('serialization_alias="postMeal"');

    const parsed = groupMeasureSchema.parse({
      label: 'Meals followed by a walk',
      n: 22,
      baselineMmol: 6.0,
      peakMmol: 9.4,
      curve: [{ minutes: 0, mmol: 6.0 }],
      postMeal: {
        n: 18,
        timeToPeakMinutes: 45,
        minutesAboveRange: 0,
        returnToRangeMinutes: null,
        areaAboveRange: 0,
        stillAboveAtWindowEnd: 0,
        shape: 'flat',
      },
    });
    expect(parsed.postMeal?.shape).toBe('flat');
  });

  it('treats a group without measurements as a group, not as a failure', () => {
    // A morning average is a level. It has no post-meal excursion, and an
    // engine build older than this one sends no such key at all — neither is
    // a malformed response, and validating either as one would take down the
    // whole evidence screen.
    const level = groupMeasureSchema.parse({ label: 'Morning average', n: 12, peakMmol: 7.1 });
    expect(level.postMeal).toBeNull();
  });

  it('lets a whole finding through with the measurements attached', () => {
    const finding = structuredFindingSchema.parse({
      findingType: 'post_meal_response',
      summary: 'Across 8 meals, glucose rose by about 6.0 mmol/L on average.',
      effectEstimate: 6.0,
      effectUnit: 'mmol/L rise from baseline',
      confidence: 0.7,
      sampleCount: 8,
      limitations: ['Meal composition varies between meals'],
      comparison: [
        {
          label: 'A typical meal',
          n: 8,
          baselineMmol: 6.0,
          peakMmol: 12.0,
          curve: [],
          postMeal: {
            n: 8,
            timeToPeakMinutes: 60,
            minutesAboveRange: 57.5,
            returnToRangeMinutes: 95,
            areaAboveRange: 61.2,
            stillAboveAtWindowEnd: 0,
            shape: 'rose_and_returned',
          },
        },
      ],
    });

    expect(finding.comparison[0].postMeal?.timeToPeakMinutes).toBe(60);
  });
});

describe('post-meal shape labels', () => {
  /**
   * Every word `_shape` can return. Read from the engine rather than listed
   * here, so a shape added there without a label here fails this instead of
   * quietly reaching a reader as a raw identifier.
   */
  const engineShapes = [...POST_MEAL.matchAll(/^ +return "([a-z_]+)"$/gm)].map(
    (m) => m[1],
  );

  it('found the shapes the engine can emit', () => {
    // Guards the regex above: if it stops matching, every assertion below
    // would pass over an empty list.
    expect(engineShapes.length).toBeGreaterThanOrEqual(5);
    expect(engineShapes).toContain('prolonged');
  });

  it('names every one of them', () => {
    // Membership in the map, not a guess at what a labelled word looks like:
    // most of these labels are the engine's word capitalised, so comparing
    // against the fallback's output would pass for a shape that has no entry.
    expect(new Set(knownPostMealShapes())).toEqual(new Set(engineShapes));

    for (const shape of engineShapes) {
      expect(postMealShapeLabel(shape).description.length).toBeGreaterThan(0);
    }
  });

  it('describes a shape without restating a threshold', () => {
    // The thresholds live in the engine's thresholds.py. A description here
    // saying "an hour or more" would be a second copy of one — wrong the day
    // it moves, and redundant beside the real figure printed above it.
    for (const shape of engineShapes) {
      expect(postMealShapeLabel(shape).description).not.toMatch(/[0-9]/);
    }
  });

  it('falls back to the word itself rather than to nothing', () => {
    const unknown = postMealShapeLabel('biphasic');
    expect(unknown.label).toBe('Biphasic');
    expect(unknown.description.length).toBeGreaterThan(0);
  });
});

/**
 * Coverage: the second half of the same duplication problem.
 *
 * `DataQuality` and the coverage thresholds exist in both languages, and the
 * thresholds decide what the platform is willing to claim. A silent
 * disagreement here means the engine computes a ceiling the interface does not
 * apply, or the reverse — and the symptom is a finding labelled differently in
 * the packet and on the screen, which is worse than either being wrong alone.
 */
describe('data quality contract', () => {
  const THRESHOLDS = engineSource(join('engines', 'thresholds.py'));

  const declared = (name: string): number => {
    const match = THRESHOLDS.match(new RegExp(`^${name}\\s*=\\s*([0-9.]+)`, 'm'));
    if (!match) throw new Error(`${name} is not declared in thresholds.py`);
    return Number(match[1]);
  };

  it('sends every field under the name the contract reads', () => {
    const body = classBody(FINDINGS, 'DataQuality');

    const aliased = [...body.matchAll(/serialization_alias="([A-Za-z]+)"/g)].map((m) => m[1]);
    const plain = [...body.matchAll(/^ {4}(coverage): /gm)].map((m) => m[1]);

    expect(new Set([...aliased, ...plain])).toEqual(
      new Set(Object.keys(dataQualitySchema.shape)),
    );
  });

  it('caps strength at the same coverage the engine does', () => {
    expect(declared('COVERAGE_FOR_WEAK')).toBe(COVERAGE_FOR_WEAK);
    expect(declared('COVERAGE_FOR_MODERATE')).toBe(COVERAGE_FOR_MODERATE);
    expect(declared('COVERAGE_FOR_STRONG')).toBe(COVERAGE_FOR_STRONG);
  });

  it('declares the field on the finding under the name the engine sends', () => {
    expect(classBody(FINDINGS, 'StructuredFinding')).toContain(
      'serialization_alias="dataQuality"',
    );
  });

  it('lets a finding through with or without it', () => {
    const quality = {
      coverage: 0.42,
      coverageBasis: 'logged meals',
      daysWithData: 10,
      daysInWindow: 30,
      sparseDays: 2,
      largestGapHours: 19.5,
      duplicateReadings: 0,
      regularFraction: 0.98,
      medianIntervalMinutes: 15,
      primarySource: 'cgm',
    };

    expect(dataQualitySchema.parse(quality).coverage).toBe(0.42);

    // A lab trend has no sampling window to be complete, and an engine build
    // older than this one sends no such key at all.
    const without = structuredFindingSchema.parse({
      findingType: 'hba1c_trend',
      summary: 'HbA1c has fallen.',
      effectEstimate: -1.1,
      effectUnit: 'mmol/mol',
      confidence: 0.7,
      sampleCount: 4,
      limitations: ['Four results'],
    });
    expect(without.dataQuality).toBeNull();
  });

  it('never lets a partial record be called strong evidence', () => {
    // The rule the whole ticket exists for, asserted on the shared function
    // that the API, the web app and the packet all call.
    expect(evidenceStrength(500, 0.99)).toBe('strong');
    expect(evidenceStrength(500, 0.99, 0.1)).toBe('insufficient');
    expect(evidenceStrength(500, 0.99, 0.4)).toBe('weak');
    expect(evidenceStrength(500, 0.99, 0.6)).toBe('moderate');
    expect(evidenceStrength(500, 0.99, 0.9)).toBe('strong');
  });

  it('lets coverage lower a claim and never raise one', () => {
    expect(evidenceStrength(4, 0.99, 1.0)).toBe('insufficient');
    expect(evidenceStrength(12, 0.95, 1.0)).toBe(evidenceStrength(12, 0.95));
  });
});
