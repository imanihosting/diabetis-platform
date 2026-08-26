/**
 * A finding exactly as the engine returns one.
 *
 * This is the page's centre of gravity. The effect estimate is not the point;
 * the two lists underneath it are. A product that tells you what it does not
 * know is making a claim you can check, and that is the whole difference
 * between evidence and advice.
 *
 * The numbers here are the real output of the pattern engine against the
 * seeded demo record, not illustrative figures.
 */
export function Finding() {
  const limitations = [
    'This is an observed association, not a controlled comparison',
    'Meals in the two groups were not matched for size or composition',
    'Activity intensity and duration were not accounted for',
  ];

  const improve = [
    'Run a trial: the same meal, alternating a walk and no walk',
    'Record how long and how briskly you walked',
  ];

  return (
    <figure className="border border-[var(--brand-rule)] bg-[var(--paper-raised)] p-[clamp(1.5rem,3vw,2.5rem)]">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-sm text-[var(--brand-ink-3)]">
          post_meal_walk_effect
        </span>
        <span className="inline-flex items-baseline gap-2 text-sm">
          <span
            aria-hidden
            className="inline-block h-2 w-2 translate-y-[-1px] rounded-full"
            style={{ background: 'var(--in-range)' }}
          />
          <span className="text-[var(--brand-ink-2)]">Moderate evidence</span>
          <span className="measure text-[var(--brand-ink-3)]">n=156</span>
        </span>
      </figcaption>

      <p className="mt-6 text-[clamp(1.5rem,1rem+1.6vw,2.25rem)] font-medium leading-[1.15] tracking-[-0.02em] text-balance">
        Meals followed by a walk were associated with a{' '}
        <span className="measure whitespace-nowrap text-[var(--in-range-text)]">
          1.1 mmol/L
        </span>{' '}
        lower rise.
      </p>

      <dl className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-[0.08em] text-[var(--brand-ink-3)]">
            What this does not account for
          </dt>
          <dd>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--brand-ink-2)]">
              {limitations.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden className="text-[var(--brand-ink-3)]">
                    &#8213;
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </dd>
        </div>

        <div>
          <dt className="text-xs uppercase tracking-[0.08em] text-[var(--brand-ink-3)]">
            What would sharpen it
          </dt>
          <dd>
            <ul className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--brand-ink-2)]">
              {improve.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span aria-hidden className="text-[var(--brand-ink-3)]">
                    &#8213;
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </figure>
  );
}
