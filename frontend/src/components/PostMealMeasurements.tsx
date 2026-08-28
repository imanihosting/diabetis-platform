import { postMealShapeLabel, type GroupMeasure, type PostMealMetrics } from '@wellovue/types';

/**
 * A meal response said the way diabetes is said.
 *
 * The chart above this shows the shape; this says what the shape measures. The
 * two are the same data and neither replaces the other — a reader can see that
 * one curve crosses the target line and the other does not, and still not know
 * whether that was for ten minutes or for ninety.
 *
 * Deliberately not a repeat of the card. The peak and the rise are already in
 * the engine's own sentence and in the chart's legend, so they are not rows
 * here; every row is something the card could not previously say at all. That
 * is the whole difference between this and a statistics readout — "a 3.1
 * mmol/L larger rise" was true, and told somebody almost nothing they could do
 * anything with.
 *
 * Laid out as a table because it is one, and because the comparison findings
 * are read across rather than down: "sixty minutes above range against five"
 * is the answer, and two stacked lists make a reader hold one column in their
 * head while they go and find the other.
 */

/** A group paired with the measurements it actually has, so nothing below re-checks. */
interface Measured {
  group: GroupMeasure;
  metrics: PostMealMetrics;
}

interface Cell {
  text: string;
  unit?: string;
  /**
   * Whether this cell is a figure.
   *
   * The tabular face is for numbers, here and everywhere else in the product —
   * it is what makes a column of them line up and scan. A word set in it reads
   * as a code rather than as English, so "Rose and returned" is prose and
   * "88 min" is not.
   */
  measure: boolean;
}

const ROWS: { label: string; cell: (m: Measured) => Cell }[] = [
  {
    label: 'Time to peak',
    cell: ({ metrics }) => ({
      text: String(Math.round(metrics.timeToPeakMinutes)),
      unit: 'min',
      measure: true,
    }),
  },
  {
    label: 'Above target range',
    cell: ({ metrics }) => ({
      text: String(Math.round(metrics.minutesAboveRange)),
      unit: 'min',
      measure: true,
    }),
  },
  {
    label: 'Back in range',
    // Three different answers, and which one it is matters more than the
    // number does. Never left range is the good one; still above at two hours
    // is the one an em dash would quietly hide.
    cell: ({ metrics }) => {
      if (metrics.returnToRangeMinutes !== null) {
        return {
          text: String(Math.round(metrics.returnToRangeMinutes)),
          unit: 'min after eating',
          measure: true,
        };
      }
      if (metrics.minutesAboveRange === 0) {
        return { text: 'Never left range', measure: false };
      }
      return { text: 'Still above at 2 hours', measure: false };
    },
  },
  {
    label: 'Excursion above target',
    cell: ({ metrics }) => ({
      text: String(Math.round(metrics.areaAboveRange)),
      unit: 'mmol/L · min',
      measure: true,
    }),
  },
  {
    label: 'Shape',
    cell: ({ metrics }) => ({ text: postMealShapeLabel(metrics.shape).label, measure: false }),
  },
  {
    label: 'Meals measured',
    // The honest denominator. These figures are averaged over the meals that
    // were watched for most of the two hours, which is not always every meal
    // in the group, and a reader who has just seen n=40 on the badge is owed
    // the difference rather than left to assume there is none.
    cell: ({ group, metrics }) => ({ text: `${metrics.n} of ${group.n}`, measure: true }),
  },
];

export function PostMealMeasurements({ groups }: { groups: GroupMeasure[] }) {
  const measured: Measured[] = groups.flatMap((group) =>
    group.postMeal ? [{ group, metrics: group.postMeal }] : [],
  );
  if (measured.length === 0) return null;

  const comparing = measured.length > 1;
  const unresolved = measured.filter((m) => m.metrics.stillAboveAtWindowEnd > 0);

  return (
    <section className="mt-6 border-t border-rule pt-4">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">
        What the response measured
      </h4>

      <div className="mt-2.5 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Post-meal glucose measurements for each group this finding compared
          </caption>
          {comparing && (
            <thead>
              <tr>
                <td />
                {measured.map(({ group }) => (
                  <th
                    key={group.label}
                    scope="col"
                    className="pb-2 pl-4 text-left text-xs font-normal leading-snug text-ink-faint"
                  >
                    {group.label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-t border-rule/60">
                <th
                  scope="row"
                  className="py-1.5 pr-4 text-left text-sm font-normal text-ink-muted"
                >
                  {row.label}
                </th>
                {measured.map((entry) => {
                  const cell = row.cell(entry);
                  return (
                    <td key={entry.group.label} className="py-1.5 pl-4 text-sm text-ink">
                      <span className={cell.measure ? 'measure' : undefined}>
                        {cell.text}
                      </span>
                      {cell.unit && (
                        <span className="ml-1.5 text-xs text-ink-faint">{cell.unit}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The shape word alone says little. What it means sits under the table
          rather than in the cell, so the column stays scannable and the
          sentence stays a sentence.

          Named per group only when the groups differ. Two responses that got
          the same word produce the same sentence twice, and printing it once
          per label reads as though something distinguished them. */}
      <ul className="mt-3 space-y-1">
        {shapeNotes(measured).map(({ key, prefix, shape }) => (
          <li key={key} className="text-xs leading-relaxed text-ink-muted">
            {prefix && <span className="text-ink-faint">{prefix}: </span>}
            <span className="text-ink">{shape.label}</span> &#8212; glucose{' '}
            {shape.description}.
          </li>
        ))}
      </ul>

      {/* Not a footnote. A meal still above target when the window closed is
          the one this table cannot finish describing, and saying how many there
          were is the difference between an average and an average with a hole
          in it. */}
      {unresolved.length > 0 && (
        <div className="mt-3 max-w-[52ch] space-y-1">
          {unresolved.map(({ group, metrics }) => {
            const count = metrics.stillAboveAtWindowEnd;
            return (
              <p key={group.label} className="text-xs leading-relaxed text-ink-muted">
                {comparing && <span className="text-ink-faint">{group.label}: </span>}
                <span className="measure">{count}</span>{' '}
                {count === 1 ? 'meal was' : 'meals were'} still above target range when the
                two hours ended, and {count === 1 ? 'it is' : 'they are'} not counted in the
                time back in range.
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * One sentence per distinct shape, not one per group.
 *
 * When two groups got the same word, the sentence explaining it is the same
 * sentence, and labelling each copy with a group name suggests the two were
 * told apart by something. They were not — what tells them apart is in the
 * rows above.
 */
function shapeNotes(measured: Measured[]) {
  const distinct = new Set(measured.map((m) => m.metrics.shape));

  if (distinct.size === 1) {
    const shape = postMealShapeLabel(measured[0].metrics.shape);
    return [{ key: shape.label, prefix: null, shape }];
  }

  return measured.map(({ group, metrics }) => ({
    key: group.label,
    prefix: group.label,
    shape: postMealShapeLabel(metrics.shape),
  }));
}
