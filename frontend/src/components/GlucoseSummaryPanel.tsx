import type { GlucoseSummary } from '@diabetes/types';
import { cn } from '@/lib/cn';

/**
 * Descriptive glucose statistics for a period.
 *
 * When there is too little data the panel says so plainly instead of showing
 * a confident-looking number built on three readings.
 */
export function GlucoseSummaryPanel({ summary }: { summary: GlucoseSummary }) {
  if (summary.sampleCount === 0) {
    return (
      <div className="rounded-md border border-line px-5 py-6 text-sm text-ink-muted">
        No glucose readings in this period.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface-raised">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4 px-5 py-4">
        <Stat label="Average" value={summary.mean} unit={summary.unit} emphasis />
        <Stat label="Lowest" value={summary.min} unit={summary.unit} />
        <Stat label="Highest" value={summary.max} unit={summary.unit} />
        <Stat
          label="Readings"
          value={summary.sampleCount}
          unit=""
        />
      </div>

      {summary.timeInRange !== null && (
        <div className="border-t border-line px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm text-ink-muted">Time in target range</span>
            <span className="tabular text-sm font-medium text-ink">
              {Math.round(summary.timeInRange * 100)}%
            </span>
          </div>

          <div
            className="flex h-2 overflow-hidden rounded-full bg-surface-sunken"
            role="img"
            aria-label={`${Math.round((summary.timeBelowRange ?? 0) * 100)} percent below target, ${Math.round(summary.timeInRange * 100)} percent in target, ${Math.round((summary.timeAboveRange ?? 0) * 100)} percent above target`}
          >
            <div className="bg-range-below" style={{ width: `${(summary.timeBelowRange ?? 0) * 100}%` }} />
            <div className="bg-range-in" style={{ width: `${summary.timeInRange * 100}%` }} />
            <div className="bg-range-above" style={{ width: `${(summary.timeAboveRange ?? 0) * 100}%` }} />
          </div>
        </div>
      )}

      {!summary.dataSufficient && (
        <p
          className={cn(
            'border-t border-line px-5 py-3 text-xs',
            'text-evidence-weak',
          )}
        >
          Based on {summary.sampleCount} reading
          {summary.sampleCount === 1 ? '' : 's'} — too few to be representative
          of this period.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  emphasis,
}: {
  label: string;
  value: number | null;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-faint">{label}</div>
      <div
        className={cn(
          'tabular mt-1 font-medium text-ink',
          emphasis ? 'text-reading-sm' : 'text-lg',
        )}
      >
        {value ?? '—'}
        {unit && <span className="ml-1 text-xs font-normal text-ink-faint">{unit}</span>}
      </div>
    </div>
  );
}
