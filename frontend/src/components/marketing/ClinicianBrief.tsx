const HBA1C = [
  { when: 'Nov', value: 7.9 },
  { when: 'Feb', value: 7.4 },
  { when: 'May', value: 7.1 },
  { when: 'Aug', value: 6.8 },
];

const RANGE = { below: 2, inRange: 78, above: 20 };

/**
 * The page a clinician actually receives.
 *
 * Rendered as the document itself rather than described in a feature grid,
 * because the claim is that ninety days fits on one page and the honest way to
 * make that claim is to show the page.
 */
export function ClinicianBrief() {
  const latest = HBA1C[HBA1C.length - 1];
  const first = HBA1C[0];

  return (
    <article className="border border-[var(--rule)] bg-[var(--paper-raised)]">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[var(--rule)] px-6 py-4 sm:px-8">
        <h3 className="text-sm font-semibold">Ninety-day summary</h3>
        <p className="measure text-xs text-[var(--ink-faint)]">
          prepared 2026-08-24
        </p>
      </header>

      <div className="divide-y divide-[var(--rule)]">
        <section className="px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-faint)]">
              HbA1c
            </h4>
            <p className="text-xs text-[var(--ink-faint)]">
              <span className="measure text-[var(--in-range-text)]">
                &#8722;{(first.value - latest.value).toFixed(1)}
              </span>{' '}
              across four measurements
            </p>
          </div>

          <ol className="mt-4 flex items-end gap-2">
            {HBA1C.map((point) => {
              // Bar height maps 6.5-8.2% onto the row, so the fall is visible
              // without exaggerating a small clinical difference.
              const height = ((point.value - 6.3) / (8.2 - 6.3)) * 100;
              return (
                <li key={point.when} className="flex-1">
                  <p className="measure mb-2 text-sm text-[var(--ink)]">
                    {point.value.toFixed(1)}
                  </p>
                  <div
                    className="w-full"
                    style={{
                      height: `${Math.max(8, height)}px`,
                      // Earlier measurements read as data, not as empty
                      // placeholders; the latest one carries the colour.
                      background:
                        point === latest
                          ? 'var(--in-range)'
                          : 'color-mix(in oklch, var(--ink-faint) 45%, var(--paper))',
                    }}
                  />
                  <p className="measure mt-2 text-xs text-[var(--ink-faint)]">
                    {point.when}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-faint)]">
              Time in range
            </h4>
            <p className="measure text-sm">{RANGE.inRange}%</p>
          </div>

          <div
            className="mt-3 flex h-2 overflow-hidden"
            role="img"
            aria-label={`${RANGE.below} percent below target, ${RANGE.inRange} percent in target, ${RANGE.above} percent above target`}
          >
            <div style={{ width: `${RANGE.below}%`, background: 'var(--below-range)' }} />
            <div style={{ width: `${RANGE.inRange}%`, background: 'var(--in-range)' }} />
            <div style={{ width: `${RANGE.above}%`, background: 'var(--above-range)' }} />
          </div>

          <p className="mt-3 text-xs text-[var(--ink-faint)]">
            Above target most often between 21:00 and 23:00.
          </p>
        </section>

        <section className="px-6 py-6 sm:px-8">
          <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-faint)]">
            What was tested
          </h4>
          <p className="mt-3 text-[0.95rem] leading-relaxed text-[var(--ink)]">
            Walking after the evening meal, six days.{' '}
            <span className="measure text-[var(--in-range-text)]">&#8722;1.3 mmol/L</span>{' '}
            <span className="text-[var(--ink-muted)]">
              against a predicted &#8722;1.3, recorded before the trial began.
            </span>
          </p>
        </section>

        <section className="px-6 py-6 sm:px-8">
          <h4 className="text-xs uppercase tracking-[0.08em] text-[var(--ink-faint)]">
            Questions raised
          </h4>
          <ul className="mt-3 space-y-2 text-[0.95rem] leading-relaxed text-[var(--ink-muted)]">
            <li className="flex gap-2.5">
              <span aria-hidden className="text-[var(--ink-faint)]">
                &#8213;
              </span>
              Evening readings stay high despite the walk. Is meal timing worth
              discussing?
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden className="text-[var(--ink-faint)]">
                &#8213;
              </span>
              Sleep is logged on 11 of 90 nights, too few to rule in or out.
            </li>
          </ul>
        </section>
      </div>
    </article>
  );
}
