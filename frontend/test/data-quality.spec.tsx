import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  dataQualityHeadline,
  dataQualityMeasurements,
  findingStrength,
  sourceLabel,
  type DataQuality,
  type StructuredFinding,
} from '@wellovue/types';
import { DataQualityPanel } from '@/components/DataQualityPanel';
import { EvidenceBadge } from '@/components/EvidenceBadge';

/**
 * What a reader is told about how complete their record is.
 *
 * The engine's half of this is tested in `test_coverage.py`. These are the
 * two things only a surface can get wrong: showing a strength the coverage
 * does not support, and describing the same figures differently on the page
 * the person reads and the page their clinician reads.
 */

function quality(over: Partial<DataQuality> = {}): DataQuality {
  return {
    coverage: 0.92,
    coverageBasis: 'logged meals',
    daysWithData: 28,
    daysInWindow: 30,
    sparseDays: 0,
    largestGapHours: 3.5,
    duplicateReadings: 0,
    regularFraction: 0.99,
    medianIntervalMinutes: 15,
    primarySource: 'cgm',
    ...over,
  };
}

function finding(over: Partial<StructuredFinding> = {}): StructuredFinding {
  return {
    findingType: 'post_meal_walk_effect',
    summary: 'A summary the engine wrote.',
    effectEstimate: -1.02,
    effectUnit: 'mmol/L difference in glucose rise',
    confidence: 0.95,
    sampleCount: 155,
    limitations: ['An observed association'],
    clinicianReviewRecommended: false,
    comparison: [],
    dataQuality: quality(),
    pValue: null,
    wouldImproveWith: [],
    ...over,
  };
}

describe('a partial record cannot look strong', () => {
  it('caps the badge on a clustered record, however many readings', () => {
    // The rule the ticket exists for, at the surface a person actually reads.
    const complete = finding();
    const clustered = finding({ dataQuality: quality({ coverage: 0.1 }) });

    expect(findingStrength(complete)).toBe('strong');
    expect(findingStrength(clustered)).toBe('insufficient');
    expect(clustered.sampleCount).toBe(complete.sampleCount);
  });

  it('renders the capped word, not the sample-count word', () => {
    const html = renderToStaticMarkup(
      <EvidenceBadge finding={finding({ dataQuality: quality({ coverage: 0.3 }) })} />,
    );
    expect(html).toContain('Weak evidence');
    expect(html).not.toContain('Strong evidence');
  });

  it('leaves a finding with no data quality exactly as it was', () => {
    // Lab trends, and anything from an engine build older than this one.
    expect(findingStrength(finding({ dataQuality: null }))).toBe('strong');
  });

  it('never lets coverage raise a claim', () => {
    expect(findingStrength(finding({ sampleCount: 6, confidence: 0.4 }))).toBe('weak');
  });
});

describe('how the record is described', () => {
  it('states the coverage against the window it is a fraction of', () => {
    expect(dataQualityHeadline(quality({ coverage: 0.42 }))).toBe(
      'Glucose was recorded for 42% of logged meals.',
    );
  });

  it('names the source, because it changes what coverage means', () => {
    expect(sourceLabel('cgm')).toBe('A sensor');
    expect(sourceLabel('meter')).toBe('A meter');
    // A word nobody has taught it must still read as English.
    expect(sourceLabel('satellite')).toBe(sourceLabel('unknown'));
  });

  it('raises a problem row only when there is a problem', () => {
    const clean = dataQualityMeasurements(quality()).map((r) => r.key);
    expect(clean).not.toContain('sparseDays');
    expect(clean).not.toContain('duplicates');

    const messy = dataQualityMeasurements(
      quality({ sparseDays: 7, duplicateReadings: 40 }),
    ).map((r) => r.key);
    expect(messy).toContain('sparseDays');
    expect(messy).toContain('duplicates');
  });

  it('says nothing at all when there is no data quality', () => {
    expect(renderToStaticMarkup(<DataQualityPanel quality={null} />)).toBe('');
  });
});

describe('the two surfaces describe the record identically', () => {
  const source = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
  const LABELS = dataQualityMeasurements(quality({ sparseDays: 2, duplicateReadings: 1 })).map(
    (r) => r.label,
  );

  it('the clinician packet asks the contract for its rows', () => {
    const report = source('src/app/report/page.tsx');
    expect(report).toContain('dataQualityMeasurements');
    expect(report).toContain('dataQualityHeadline');
  });

  it('neither surface hard-codes a label of its own', () => {
    for (const path of [
      'src/components/DataQualityPanel.tsx',
      'src/app/report/page.tsx',
    ]) {
      const text = source(path);
      for (const label of LABELS) {
        expect(text, `${path} hard-codes "${label}"`).not.toContain(`>${label}<`);
        expect(text, `${path} hard-codes "${label}"`).not.toContain(`"${label}"`);
      }
    }
  });
});
