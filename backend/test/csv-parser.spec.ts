import { describe, expect, it } from 'vitest';
import { parseGlucoseCsv } from '../src/glucose/csv-parser';

describe('parseGlucoseCsv', () => {
  it('parses a LibreView-style export and reads the unit from the header', () => {
    const csv = [
      'Device,Serial Number,Device Timestamp,Record Type,Historic Glucose mmol/L',
      'FreeStyle Libre,ABC,2026-08-01 08:15,0,6.4',
      'FreeStyle Libre,ABC,2026-08-01 08:30,0,7.1',
    ].join('\n');

    const { samples, rejected } = parseGlucoseCsv(csv);

    expect(rejected).toEqual([]);
    expect(samples).toHaveLength(2);
    expect(samples[0].value).toBe(6.4);
    expect(samples[0].unit).toBe('mmol/L');
  });

  it('reads mg/dL from the header rather than guessing', () => {
    const csv = ['Timestamp,Glucose mg/dL', '2026-08-01 08:15,126'].join('\n');
    const { samples } = parseGlucoseCsv(csv);

    expect(samples[0].unit).toBe('mg/dL');
    expect(samples[0].value).toBe(126);
  });

  it('skips vendor preamble rows before the real header', () => {
    const csv = [
      'Glucose Data,Generated on,2026-08-01',
      'Some vendor blurb',
      'Device Timestamp,Historic Glucose mmol/L',
      '2026-08-01 08:15,6.4',
    ].join('\n');

    expect(parseGlucoseCsv(csv).samples).toHaveLength(1);
  });

  it('infers the unit from magnitude when the header does not declare one', () => {
    const csv = ['Timestamp,Glucose', '2026-08-01 08:15,6.4', '2026-08-01 08:30,126'].join('\n');
    const { samples } = parseGlucoseCsv(csv);

    expect(samples[0].unit).toBe('mmol/L');
    expect(samples[1].unit).toBe('mg/dL');
  });

  it('rejects a value in the ambiguous band rather than guessing its unit', () => {
    // 36 is implausible as mmol/L and implausible as mg/dL. Guessing either way
    // would silently corrupt a glucose reading, so the row is rejected.
    const csv = ['Timestamp,Glucose', '2026-08-01 08:15,36'].join('\n');
    const { samples, rejected } = parseGlucoseCsv(csv);

    expect(samples).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/Ambiguous unit/);
  });

  it('rejects unparseable rows with a line number and keeps the good ones', () => {
    const csv = [
      'Device Timestamp,Historic Glucose mmol/L',
      'not-a-date,6.4',
      '2026-08-01 08:30,not-a-number',
      '2026-08-01 08:45,7.2',
    ].join('\n');

    const { samples, rejected } = parseGlucoseCsv(csv);

    expect(samples).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected[0].line).toBe(2);
    expect(rejected[1].line).toBe(3);
  });

  it('handles quoted fields containing commas', () => {
    const csv = [
      'Device,Device Timestamp,Historic Glucose mmol/L',
      '"Meter, model X",2026-08-01 08:15,6.4',
    ].join('\n');

    expect(parseGlucoseCsv(csv).samples[0].value).toBe(6.4);
  });

  it('reports a clear failure when no glucose column exists at all', () => {
    const { samples, rejected } = parseGlucoseCsv('Name,Notes\nfoo,bar');

    expect(samples).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/No recognisable/);
  });
});

describe('parseGlucoseCsv timestamp handling', () => {
  it('honours an explicit UTC offset', () => {
    const csv = ['Timestamp,Glucose mmol/L', '2026-06-01T08:15:00Z,6.4'].join('\n');
    const [sample] = parseGlucoseCsv(csv).samples;

    expect(sample.measuredAt.toISOString()).toBe('2026-06-01T08:15:00.000Z');
  });

  it('reads an offset-less timestamp as server-local time', () => {
    // Pinning documented behaviour rather than endorsing it: most CGM exports
    // write local wall-clock time with no offset, so the reading lands
    // wherever the server's timezone puts it. See the note in csv-parser.ts.
    const csv = ['Timestamp,Glucose mmol/L', '2026-06-01 08:15,6.4'].join('\n');
    const [sample] = parseGlucoseCsv(csv).samples;

    expect(sample.measuredAt.getFullYear()).toBe(2026);
    expect(sample.measuredAt.getHours()).toBe(8);
    expect(sample.measuredAt.getMinutes()).toBe(15);
  });
});
