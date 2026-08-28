import { TARGET_HIGH_MMOL, TARGET_LOW_MMOL, type GroupMeasure } from '@wellovue/types';

/**
 * A finding drawn the way the timeline draws a day.
 *
 * Same language deliberately: a fixed vertical scale so the same shape means
 * the same thing on every card, the target band as ground behind the trace,
 * one ink polyline through the readings, and the axis underneath. Somebody who
 * has read their own timeline already knows how to read this, which is the
 * whole reason not to invent a second chart style.
 *
 * Every point is measured. The curve is the group's mean glucose at each
 * fifteen-minute offset from the meal, averaged across the meals in that
 * group by the engine; nothing here interpolates, smooths, or extends a line
 * past the last reading.
 *
 * The band is what makes this diabetes rather than statistics. A difference of
 * 1.1 mmol/L between two groups says nothing about whether either ended up in
 * range; two traces against the band say it at a glance.
 */

/** The timeline's scale, so a shape means the same thing on both surfaces. */
const SCALE_MIN = 3;
const SCALE_MAX = 14;

export function FindingTrace({ groups }: { groups: GroupMeasure[] }) {
  const drawable = groups.filter((g) => g.curve.length >= 2);
  if (drawable.length === 0) return null;

  const lastMinute = Math.max(
    ...drawable.flatMap((g) => g.curve.map((p) => p.minutes)),
  );
  if (lastMinute <= 0) return null;

  const x = (minutes: number) => (minutes / lastMinute) * 100;
  const y = (mmol: number) =>
    ((SCALE_MAX - Math.min(Math.max(mmol, SCALE_MIN), SCALE_MAX)) /
      (SCALE_MAX - SCALE_MIN)) *
    100;

  return (
    <figure className="mt-5">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={drawable
          .map(
            (g) =>
              `${g.label}: ${g.baselineMmol} rising to ${g.peakMmol} millimoles per litre over ${lastMinute} minutes`,
          )
          .join('. ')}
      >
        {/* Target band, behind the traces, at the timeline's weight. */}
        <rect
          x="0"
          y={y(TARGET_HIGH_MMOL)}
          width="100"
          height={y(TARGET_LOW_MMOL) - y(TARGET_HIGH_MMOL)}
          className="fill-[color-mix(in_oklch,var(--in-range)_14%,transparent)]"
        />
        {/* The upper bound, drawn. Whether a curve crosses this line is the
            whole question on most of these cards, so the line has to be
            visible rather than implied by where the wash stops. */}
        <line
          x1="0"
          x2="100"
          y1={y(TARGET_HIGH_MMOL)}
          y2={y(TARGET_HIGH_MMOL)}
          stroke="var(--in-range)"
          strokeWidth="1"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
          opacity="0.8"
        />

        {drawable.map((group, index) => (
          <path
            key={group.label}
            d={group.curve
              .map(
                (point, i) =>
                  `${i === 0 ? 'M' : 'L'} ${x(point.minutes).toFixed(2)} ${y(point.mmol).toFixed(2)}`,
              )
              .join(' ')}
            fill="none"
            className="stroke-ink"
            strokeWidth={index === 0 ? 1.75 : 1}
            // The second group is dashed rather than tinted. Colour here means
            // where a value sits against target, and using it to tell two
            // series apart would break that for the reader everywhere else.
            strokeDasharray={index === 0 ? undefined : '3 2.5'}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      {/* The band's value, named. Without it the dashed line is a divider;
          with it the chart says which side of target each curve is on. */}
      <div className="mt-1 flex items-baseline justify-between text-[10px] text-ink-faint">
        <span className="measure">0 min</span>
        <span className="measure">{Math.round(lastMinute / 2)}</span>
        <span className="measure">{lastMinute} min</span>
      </div>
      <p className="mt-1 text-[10px] text-ink-faint">
        Dashed line is the top of target range,{' '}
        <span className="measure">{TARGET_HIGH_MMOL}</span> mmol/L.
      </p>

      <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {drawable.map((group, index) => (
          <div key={group.label} className="flex items-baseline gap-2">
            {/* The legend carries the line, so the key is the mark itself. */}
            <svg width="18" height="6" aria-hidden className="shrink-0">
              <line
                x1="0"
                x2="18"
                y1="3"
                y2="3"
                className="stroke-ink"
                strokeWidth={index === 0 ? 1.75 : 1}
                strokeDasharray={index === 0 ? undefined : '3 2.5'}
              />
            </svg>
            <p className="text-xs leading-snug text-ink-muted">
              {group.label}{' '}
              <span className="text-ink-faint">
                <span className="measure">
                  {group.baselineMmol} → {group.peakMmol}
                </span>{' '}
                mmol/L · <span className="measure">n={group.n}</span>
              </span>
            </p>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}
