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
    // The export has already answered which instant it means, so the account's
    // timezone is not consulted.
    const csv = ['Timestamp,Glucose mmol/L', '2026-06-01T08:15:00Z,6.4'].join('\n');
    const [sample] = parseGlucoseCsv(csv, 'csv_import', 'Australia/Sydney').samples;

    expect(sample.measuredAt.toISOString()).toBe('2026-06-01T08:15:00.000Z');
  });

  it('honours a written offset that is not UTC', () => {
    const csv = ['Timestamp,Glucose mmol/L', '2026-06-01T08:15:00+10:00,6.4'].join('\n');
    const [sample] = parseGlucoseCsv(csv, 'csv_import', 'UTC').samples;

    expect(sample.measuredAt.toISOString()).toBe('2026-05-31T22:15:00.000Z');
  });

  it('reads an offset-less timestamp in the account timezone', () => {
    // The device wrote the person's wall clock. 08:15 in Sydney is 22:15 UTC
    // the previous day, and reading it as the server's clock used to move it
    // by however far the server happened to be from the phone.
    const csv = ['Timestamp,Glucose mmol/L', '2026-06-01 08:15,6.4'].join('\n');
    const [sample] = parseGlucoseCsv(csv, 'csv_import', 'Australia/Sydney').samples;

    expect(sample.measuredAt.toISOString()).toBe('2026-05-31T22:15:00.000Z');
  });

  it('does not consult the server timezone at all', () => {
    // The same row, read for two accounts, lands at two instants — and neither
    // depends on where this process runs. That independence is the fix.
    const csv = ['Timestamp,Glucose mmol/L', '2026-06-01 08:15,6.4'].join('\n');

    const dublin = parseGlucoseCsv(csv, 'csv_import', 'Europe/Dublin').samples[0];
    const losAngeles = parseGlucoseCsv(csv, 'csv_import', 'America/Los_Angeles').samples[0];

    expect(dublin.measuredAt.toISOString()).toBe('2026-06-01T07:15:00.000Z');
    expect(losAngeles.measuredAt.toISOString()).toBe('2026-06-01T15:15:00.000Z');
  });

  it('follows daylight saving rather than a fixed offset', () => {
    // Dublin is UTC+1 in June and UTC+0 in December. An offset stored once
    // would be wrong for half the year, which is why the account carries an
    // IANA name.
    const june = parseGlucoseCsv(
      ['Timestamp,Glucose mmol/L', '2026-06-01 08:15,6.4'].join('\n'),
      'csv_import',
      'Europe/Dublin',
    ).samples[0];
    const december = parseGlucoseCsv(
      ['Timestamp,Glucose mmol/L', '2026-12-01 08:15,6.4'].join('\n'),
      'csv_import',
      'Europe/Dublin',
    ).samples[0];

    expect(june.measuredAt.toISOString()).toBe('2026-06-01T07:15:00.000Z');
    expect(december.measuredAt.toISOString()).toBe('2026-12-01T08:15:00.000Z');
  });

  it('defaults to UTC when no timezone is supplied', () => {
    const csv = ['Timestamp,Glucose mmol/L', '2026-06-01 08:15,6.4'].join('\n');
    const [sample] = parseGlucoseCsv(csv).samples;

    expect(sample.measuredAt.toISOString()).toBe('2026-06-01T08:15:00.000Z');
  });

  it('rejects an offset-less shape it cannot read, rather than guessing', () => {
    // `new Date` would always produce an answer here, applying the server's
    // zone and reintroducing exactly the bug this replaced. A rejected row
    // carries a line number and can be fixed; a wrong glucose timestamp is
    // indistinguishable from a real reading.
    const csv = ['Timestamp,Glucose mmol/L', '06/01/2026 08:15,6.4'].join('\n');
    const result = parseGlucoseCsv(csv, 'csv_import', 'Europe/Dublin');

    expect(result.samples).toHaveLength(0);
    expect(result.rejected[0].line).toBe(2);
    expect(result.rejected[0].reason).toMatch(/Unparseable timestamp/);
  });
});

