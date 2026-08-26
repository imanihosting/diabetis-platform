const ENTRIES = [
  { time: '13:05', label: 'Rice and vegetables', source: 'Entered by you', certain: true },
  { time: '13:29', label: 'Walked 14 minutes', source: 'Entered by you', certain: true },
  { time: '14:05', label: 'Glucose 8.4 mmol/L', source: 'CGM', certain: true, value: true },
  { time: '18:40', label: 'Metformin taken', source: 'Entered by you', certain: true },
  { time: '20:40', label: 'Pasta with sauce', source: 'Estimated', certain: false },
  { time: '21:40', label: 'Glucose 12.2 mmol/L', source: 'CGM', certain: true, value: true, above: true },
];

/**
 * A slice of the timeline, with provenance on every line.
 *
 * The dot is the entire argument: filled where the platform observed something,
 * hollow where it inferred it. A person deciding what to trust about their own
 * body should not have to hunt for that difference.
 */
export function TimelineExcerpt() {
  return (
    <ol className="border-l border-[var(--rule)]">
      {ENTRIES.map((entry) => (
        <li key={entry.time + entry.label} className="relative py-3.5 pl-6">
          <span
            aria-hidden
            className="absolute -left-[4.5px] top-[1.45rem] h-2 w-2 rounded-full"
            style={{
              background: entry.certain ? 'var(--ink)' : 'var(--paper)',
              boxShadow: entry.certain
                ? 'none'
                : 'inset 0 0 0 1.5px var(--above-range)',
            }}
          />

          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
            <span className="flex items-baseline gap-3">
              <time className="measure text-xs text-[var(--ink-faint)]">
                {entry.time}
              </time>
              <span
                className={
                  entry.value
                    ? `measure text-[0.95rem] ${entry.above ? 'text-[var(--above-range-text)]' : 'text-[var(--in-range-text)]'}`
                    : 'text-[0.95rem] text-[var(--ink)]'
                }
              >
                {entry.label}
                {entry.above && <span className="sr-only"> (above target range)</span>}
              </span>
            </span>

            <span className="text-xs text-[var(--ink-faint)]">
              {entry.source}
              {!entry.certain && ' · 60% confidence'}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
