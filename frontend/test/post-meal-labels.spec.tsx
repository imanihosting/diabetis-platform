import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  postMealCaveat,
  postMealMeasurements,
  type GroupMeasure,
} from '@wellovue/types';
import { PostMealMeasurements } from '@/components/PostMealMeasurements';

/**
 * One measurement, one name, on every surface that shows it.
 *
 * The person reads these on their evidence page and their clinician reads the
 * same numbers in the packet. If the two pages name them differently, one
 * measurement becomes two in the appointment it was built to improve — so the
 * labels live in the shared contract, and this is what stops either surface
 * quietly typing its own.
 */

function group(over: Partial<GroupMeasure> = {}): GroupMeasure {
  return {
    label: 'A typical meal',
    n: 22,
    baselineMmol: 6.0,
    peakMmol: 10.8,
    curve: [],
    postMeal: {
      n: 18,
      timeToPeakMinutes: 60,
      minutesAboveRange: 57.5,
      returnToRangeMinutes: 95,
      areaAboveRange: 61.2,
      stillAboveAtWindowEnd: 0,
      shape: 'rose_and_returned',
    },
    ...over,
  };
}

const SHARED_LABELS = (postMealMeasurements(group()) ?? []).map((r) => r.label);

const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

describe('postMealMeasurements', () => {
  it('says nothing for a group with no measurements', () => {
    expect(postMealMeasurements({ n: 12, postMeal: null })).toBeNull();
  });

  it('reports the meals it could measure against the meals in the group', () => {
    const rows = postMealMeasurements(group()) ?? [];
    const measured = rows.find((r) => r.key === 'mealsMeasured');
    expect(measured?.value).toBe('18 of 22');
  });

  it('distinguishes the three answers to "back in range"', () => {
    const came = postMealMeasurements(group())?.find((r) => r.key === 'returnToRange');
    expect(came?.value).toBe('95');
    expect(came?.unit).toBe('min after eating');

    const never = postMealMeasurements(
      group({
        postMeal: { ...group().postMeal!, returnToRangeMinutes: null, minutesAboveRange: 0 },
      }),
    )?.find((r) => r.key === 'returnToRange');
    expect(never?.value).toBe('Never left range');

    // The one an em dash would hide.
    const stuck = postMealMeasurements(
      group({
        postMeal: {
          ...group().postMeal!,
          returnToRangeMinutes: null,
          minutesAboveRange: 97.5,
          stillAboveAtWindowEnd: 4,
        },
      }),
    )?.find((r) => r.key === 'returnToRange');
    expect(stuck?.value).toBe('Still above at 2 hours');
  });

  it('sets words in prose and figures in the tabular face', () => {
    const rows = postMealMeasurements(group()) ?? [];
    expect(rows.find((r) => r.key === 'timeToPeak')?.measure).toBe(true);
    expect(rows.find((r) => r.key === 'shape')?.measure).toBe(false);
  });

  it('only raises the unresolved meals when there are some', () => {
    expect(postMealCaveat(group())).toBeNull();

    const caveat = postMealCaveat(
      group({ postMeal: { ...group().postMeal!, stillAboveAtWindowEnd: 1 } }),
    );
    expect(caveat).toContain('1 meal was still above target range');
    // Words in a sentence, figures in a cell. Both name the same window.
    expect(caveat).toContain('two hours');
    expect(
      postMealMeasurements(
        group({
          postMeal: {
            ...group().postMeal!,
            returnToRangeMinutes: null,
            minutesAboveRange: 90,
          },
        }),
      )?.find((r) => r.key === 'returnToRange')?.value,
    ).toBe('Still above at 2 hours');
  });
});

describe('the two surfaces name the measurements identically', () => {
  it('the evidence card renders exactly the shared labels', () => {
    const html = renderToStaticMarkup(<PostMealMeasurements groups={[group()]} />);
    for (const label of SHARED_LABELS) {
      expect(html, `evidence card is missing "${label}"`).toContain(label);
    }
  });

  it('the clinician packet asks the contract for its rows', () => {
    // Not a style preference. The packet showing the older, thinner version of
    // a finding the person can already see in full is the split this exists to
    // prevent.
    const report = source('src/app/report/page.tsx');
    expect(report).toContain('postMealMeasurements');
    expect(report).toContain('postMealCaveat');
  });

  it('neither surface hard-codes a label of its own', () => {
    // The failure this catches: somebody types "Area above range" into one
    // page. Both would still render, and the two readers would be looking at
    // one measurement under two names.
    for (const path of [
      'src/components/PostMealMeasurements.tsx',
      'src/app/report/page.tsx',
    ]) {
      const text = source(path);
      for (const label of SHARED_LABELS) {
        expect(text, `${path} hard-codes "${label}"`).not.toContain(`>${label}<`);
        expect(text, `${path} hard-codes "${label}"`).not.toContain(`"${label}"`);
      }
    }
  });
});
