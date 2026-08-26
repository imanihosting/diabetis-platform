import type { CreateGlucoseSampleInput, DataSource, GlucoseUnit } from '@wellovue/types';

export interface CsvParseResult {
  samples: CreateGlucoseSampleInput[];
  rejected: { line: number; reason: string }[];
}

/**
 * Parses a CGM or glucose-meter CSV export.
 *
 * Vendor exports differ in column naming, units, and preamble rows, so this
 * matches headers by intent rather than by exact name. Anything it cannot
 * confidently interpret is rejected with a line number rather than guessed —
 * a silently mis-parsed glucose value is worse than a rejected row.
 *
 * TIMEZONES: most CGM exports write local wall-clock time with no offset
 * (`2026-06-01 08:15`). Those are interpreted in the *server's* timezone,
 * which is correct only when the server and the device agree. Timestamps that
 * carry an explicit offset or `Z` are honoured as written. Until the platform
 * stores a per-user timezone, run the API in UTC and treat offset-less
 * exports from other timezones as approximate.
 */
export function parseGlucoseCsv(
  content: string,
  source: DataSource = 'csv_import',
): CsvParseResult {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rejected: CsvParseResult['rejected'] = [];
  const samples: CreateGlucoseSampleInput[] = [];

  const headerIndex = lines.findIndex((l) => detectColumns(splitCsvLine(l)) !== null);
  if (headerIndex === -1) {
    return {
      samples: [],
      rejected: [{ line: 0, reason: 'No recognisable timestamp and glucose columns' }],
    };
  }

  const columns = detectColumns(splitCsvLine(lines[headerIndex]))!;

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const rawTime = cells[columns.time]?.trim();
    const rawValue = cells[columns.value]?.trim();

    if (!rawTime || !rawValue) continue; // blank/padding row

    const measuredAt = new Date(rawTime);
    if (Number.isNaN(measuredAt.getTime())) {
      rejected.push({ line: i + 1, reason: `Unparseable timestamp: "${rawTime}"` });
      continue;
    }

    const value = Number(rawValue.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      rejected.push({ line: i + 1, reason: `Unparseable glucose value: "${rawValue}"` });
      continue;
    }

    const unit = columns.unit ?? inferUnit(value);
    if (!unit) {
      rejected.push({
        line: i + 1,
        reason: `Ambiguous unit for value ${value}; declare the unit in the CSV header`,
      });
      continue;
    }

    samples.push({ measuredAt, value, unit, source });
  }

  return { samples, rejected };
}

interface DetectedColumns {
  time: number;
  value: number;
  unit: GlucoseUnit | null;
}

function detectColumns(header: string[]): DetectedColumns | null {
  const normalised = header.map((h) => h.toLowerCase().trim());

  const time = normalised.findIndex((h) =>
    /(timestamp|date.?time|device timestamp|time|date)/.test(h),
  );
  const value = normalised.findIndex((h) =>
    /(glucose|historic|scan|bg|blood sugar|reading|value)/.test(h),
  );
  if (time === -1 || value === -1) return null;

  // The unit is usually declared in the glucose column header itself.
  const valueHeader = normalised[value];
  let unit: GlucoseUnit | null = null;
  if (/mmol/.test(valueHeader)) unit = 'mmol/L';
  else if (/mg\s*\/?\s*dl/.test(valueHeader)) unit = 'mg/dL';

  return { time, value, unit };
}

/**
 * Physiological glucose in mmol/L is roughly 1-33; in mg/dL roughly 20-600.
 * The ranges only overlap in a band that is implausible for both, so values
 * inside it are rejected rather than guessed.
 */
function inferUnit(value: number): GlucoseUnit | null {
  if (value <= 33) return 'mmol/L';
  if (value >= 40) return 'mg/dL';
  return null;
}

/** Minimal RFC4180-style splitter: handles quoted fields and escaped quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === ';' || char === '\t') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
