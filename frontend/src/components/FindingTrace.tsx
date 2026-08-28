import { TARGET_HIGH_MMOL, TARGET_LOW_MMOL, type GroupMeasure } from '@wellovue/types';

/**
 * A finding drawn in glucose, against the band it is actually about.
 *
 * Every number here was measured. `baselineMmol` and `peakMmol` come from the
 * detector that produced the finding; nothing is interpolated, smoothed or
 * invented, and the curve between the two points is drawn as a curve because
 * that is what glucose does between a meal and its peak, not because a
 * straight line looked plain.
 *
 * The band is the point. A difference of 1.1 mmol/L between two groups tells
 * a reader nothing about whether either group was in range; two curves against
 * the target band tell them immediately, which is the difference between a
 * statistic and something about their body.
 *
 * A group with no peak draws nothing rather than a placeholder. Lab trends
 * have no band to sit against, so findings without a comparison render no
 * chart at all — an empty axis would imply the data exists and is zero.
 */
export function FindingTrace({ groups }: { groups: GroupMeasure[] }) {
  const drawable = groups.filter((g) => g.peakMmol !== null);
  if (drawable.length === 0) return null;

  const values = drawable.flatMap((g) =>
    [g.baselineMmol, g.peakMmol].filter((v): v is number => v !== null),
  );

  // The band is always in frame even when every reading sits above it, so the
  // scale never flatters a record by cropping the target out of view.
  const low = Math.min(...values, TARGET_LOW_MMOL) - 0.6;
  const high = Math.max(...values, TARGET_HIGH_MMOL) + 0.6;
  const y = (mmol: number) => 100 - ((mmol - low) / (high - low)) * 100;

  return (
    <figure className="mt-5">
      <svg
        viewBox="0 0 200 100"
        preserveAspectRatio="none"
        className="h-[8.5rem] w-full"
        role="img"
        aria-label={drawable
          .map((g) =>
            g.baselineMmol === null
              ? `${g.label}: ${g.peakMmol} mmol/L`
              : `${g.label}: ${g.baselineMmol} rising to ${g.peakMmol} mmol/L`,
          )
          .join('. ')}
      >
        {/* Target band, drawn as ground. Same wash and dashed upper bound as
            every other chart here, so a reader learns the shape once. */}
        <rect
          x="0"
          y={y(TARGET_HIGH_MMOL)}
          width="200"
          height={Math.max(0, y(TARGET_LOW_MMOL) - y(TARGET_HIGH_MMOL))}
          // Held below full wash, as the hero trace is. The token is tuned to
          // sit behind a dense chart; the target range is 3.9 to 10, so on a
          // small frame it fills most of the height and reads as a green
          // panel rather than as a band a reading sits inside.
          fill="color-mix(in oklch, var(--in-range-wash) 70%, var(--paper))"
        />
        <line
          x1="0"
          x2="200"
          y1={y(TARGET_HIGH_MMOL)}
          y2={y(TARGET_HIGH_MMOL)}
          stroke="var(--in-range)"
          strokeWidth="1"
          strokeDasharray="3 5"
          vectorEffect="non-scaling-stroke"
          opacity="0.75"
        />

        {drawable.map((group, index) => {
          // Groups share the width so they can be compared at a glance; a
          // second group drawn on its own axis would be two charts.
          const span = 200 / drawable.length;
          const x0 = index * span + span * 0.16;
          const x1 = index * span + span * 0.84;
          const mid = (x0 + x1) / 2;

          if (group.baselineMmol === null) {
            // A level, not a movement: one mark, no curve to imply a rise.
            return (
              <line
                key={group.label}
                x1={x0}
                x2={x1}
                y1={y(group.peakMmol as number)}
                y2={y(group.peakMmol as number)}
                stroke="var(--ink)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
            );
          }

          return (
            <path
              key={group.label}
              // The control point sits at the peak, not above it, so the
              // curve eases into its maximum and never exceeds it. Lifting it
              // by a few units looked more like glucose and drew a line above
              // the highest value actually measured, which on a chart about
              // what happened is a small lie.
              d={`M ${x0} ${y(group.baselineMmol)} Q ${mid} ${y(group.peakMmol as number)} ${x1} ${y(group.peakMmol as number)}`}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      <figcaption className="mt-2 flex gap-4">
        {drawable.map((group) => (
          <div key={group.label} className="flex-1">
            <p className="text-xs leading-snug text-ink-muted">{group.label}</p>
            <p className="mt-0.5 text-xs text-ink-faint">
              <span className="measure">
                {group.baselineMmol !== null && `${group.baselineMmol} → `}
                {group.peakMmol}
              </span>{' '}
              mmol/L · <span className="measure">n={group.n}</span>
            </p>
          </div>
        ))}
      </figcaption>
    </figure>
  );
}
