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
 * (`2026-06-01 08:15`). Those are the device's clock, which is the person's
 * clock, so they are read in the account's timezone rather than the server's.
 * Timestamps carrying an explicit offset or `Z` are honoured exactly as
 * written, because the export has already answered the question.
 *
 * The server's own zone is never consulted. It used to be, and that was
 * correct only when the server and the device happened to agree — an import
 * from a phone in Sydney into an API running in UTC shifted every reading by
 * eleven hours, which then moved meals across the late-meal boundary and into
 * or out of the morning window.
 *
 * An offset-less timestamp in a shape this cannot read is rejected with its
 * line number rather than handed to `new Date`, which would apply the server
 * zone again and silently reintroduce the same error. That is the same trade
 * the rest of this parser makes: a rejected row is recoverable, a wrong
 * glucose timestamp is not.
 */
export function parseGlucoseCsv(
  content: string,
  source: DataSource = 'csv_import',
  timezone = 'UTC',
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

    const measuredAt = parseTimestamp(rawTime, timezone);
    if (measuredAt === null) {
      rejected.push({
        line: i + 1,
        reason:
          `Unparseable timestamp: "${rawTime}". Expected an ISO-like local ` +
          'time (2026-06-01 08:15) or one carrying an explicit offset.',
      });
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

/** A timestamp that already says which instant it means. */
const CARRIES_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** `2026-06-01 08:15`, `2026-06-01T08:15:30`, and the usual variations. */
const WALL_CLOCK =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * The instant a CSV timestamp refers to.
 *
 * Returns null rather than guessing. `new Date('2026-06-01 08:15')` silently
 * applies whatever zone the process happens to run in, which is the bug this
 * function exists to remove — so anything not recognised is refused instead of
 * being parsed by a function that will always produce *an* answer.
 */
function parseTimestamp(raw: string, timezone: string): Date | null {
  if (CARRIES_OFFSET.test(raw)) {
    const explicit = new Date(raw);
    return Number.isNaN(explicit.getTime()) ? null : explicit;
  }

  const match = WALL_CLOCK.exec(raw.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const wallAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0'),
  );
  if (Number.isNaN(wallAsUtc)) return null;

  // Two passes. The offset depends on the instant, and the instant is what we
  // are solving for, so the first pass uses the wall clock read as UTC to pick
  // a plausible offset and the second re-reads it at the instant that implies.
  // The two differ only within an hour of a daylight-saving change, which is
  // exactly when getting it wrong would be least noticeable.
  const firstPass = wallAsUtc - offsetAt(new Date(wallAsUtc), timezone);
  const settled = wallAsUtc - offsetAt(new Date(firstPass), timezone);
  const at = new Date(settled);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** How far ahead of UTC `timezone` is at this instant, in milliseconds. */
function offsetAt(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl renders midnight as 24 in some locales/engines.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return localAsUtc - instant.getTime();
}
