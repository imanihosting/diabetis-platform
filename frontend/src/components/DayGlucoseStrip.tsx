import type { TimelineEntry } from '@wellovue/types';

const TARGET_LOW_MMOL = 3.9;
const TARGET_HIGH_MMOL = 10.0;

interface Reading {
  at: Date;
  mmol: number;
}

/**
 * A day of continuous glucose, drawn as one strip.
 *
 * A CGM produces ~96 readings a day. Listing them as timeline entries buries
 * the meals, doses and walks underneath them — and those are what the person
 * can actually act on. So the readings become context: a single trace showing
 * the shape of the day, with the target band drawn behind it.
 */
export function DayGlucoseStrip({ entries }: { entries: TimelineEntry[] }) {
  const readings = toReadings(entries);
  if (readings.length === 0) return null;

  const dayStart = startOfDay(readings[0].at);
  const values = readings.map((r) => r.mmol);

  // A fixed scale, so the same shape means the same thing on every day.
  const scaleMin = Math.min(3, Math.floor(Math.min(...values)));
  const scaleMax = Math.max(14, Math.ceil(Math.max(...values)));
  const span = scaleMax - scaleMin;

  const x = (at: Date) =>
    ((at.getTime() - dayStart.getTime()) / (24 * 60 * 60 * 1000)) * 100;
  const y = (mmol: number) => ((scaleMax - mmol) / span) * 100;

  const path = readings
    .map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(r.at).toFixed(2)} ${y(r.mmol).toFixed(2)}`)
    .join(' ');

  const inRange = values.filter(
    (v) => v >= TARGET_LOW_MMOL && v <= TARGET_HIGH_MMOL,
  ).length;

  return (
    <figure className="mb-2 rounded-md border border-line bg-surface-raised px-4 py-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-xs">
        <span className="text-ink-muted">
          Glucose · <span className="tabular">{readings.length}</span> readings
        </span>
        <span className="tabular text-ink-faint">
          {Math.min(...values).toFixed(1)}–{Math.max(...values).toFixed(1)} mmol/L
          {' · '}
          {Math.round((inRange / values.length) * 100)}% in target
        </span>
      </figcaption>

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label={`Glucose across the day, ranging ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)} millimoles per litre, ${Math.round((inRange / values.length) * 100)} percent within target range`}
      >
        {/* Target band, drawn behind the trace. */}
        <rect
          x="0"
          y={y(TARGET_HIGH_MMOL)}
          width="100"
          height={y(TARGET_LOW_MMOL) - y(TARGET_HIGH_MMOL)}
          className="fill-range-in/10"
        />
        <path
          d={path}
          fill="none"
          className="stroke-accent"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-1 flex justify-between text-[10px] tabular text-ink-faint">
        <span>00:00</span>
        <span>12:00</span>
        <span>24:00</span>
      </div>
    </figure>
  );
}

function toReadings(entries: TimelineEntry[]): Reading[] {
  return entries
    .filter((e) => e.eventType === 'glucose_sample')
    .map((e) => {
      const payload = e.payload as { value: number; unit: 'mmol/L' | 'mg/dL' };
      return {
        at: new Date(e.occurredAt),
        mmol:
          payload.unit === 'mmol/L' ? payload.value : payload.value / 18.0182,
      };
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}
