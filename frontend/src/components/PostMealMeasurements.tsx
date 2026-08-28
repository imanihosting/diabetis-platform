import {
  postMealCaveat,
  postMealMeasurements,
  postMealShapeLabel,
  type GroupMeasure,
  type PostMealMeasurement,
} from '@wellovue/types';

/**
 * A meal response said the way diabetes is said.
 *
 * The chart above this shows the shape; this says what the shape measures. The
 * two are the same data and neither replaces the other — a reader can see that
 * one curve crosses the target line and the other does not, and still not know
 * whether that was for ten minutes or for ninety.
 *
 * The rows and their labels come from `postMealMeasurements()` in the shared
 * contract rather than from here, because the clinician packet shows the same
 * numbers and the two must not name them differently. A clinician reading
 * "excursion above target" while the person quotes "area above range" from
 * their own screen has been handed one measurement as two.
 *
 * What is local to this component is the layout: a table, because the
 * comparison findings are read across rather than down. "Sixty minutes above
 * range against five" is the answer, and two stacked lists make a reader hold
 * one column in their head while they go and find the other.
 */

interface Measured {
  group: GroupMeasure;
  rows: PostMealMeasurement[];
}

export function PostMealMeasurements({ groups }: { groups: GroupMeasure[] }) {
  const measured: Measured[] = groups.flatMap((group) => {
    const rows = postMealMeasurements(group);
    return rows ? [{ group, rows }] : [];
  });
  if (measured.length === 0) return null;

  const comparing = measured.length > 1;
  const labels = measured[0].rows.map((row) => row.label);
  const caveats = measured
    .map(({ group }) => ({ group, caveat: postMealCaveat(group) }))
    .filter((c): c is { group: GroupMeasure; caveat: string } => c.caveat !== null);

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
            {labels.map((label, row) => (
              <tr key={label} className="border-t border-rule/60">
                <th
                  scope="row"
                  className="py-1.5 pr-4 text-left text-sm font-normal text-ink-muted"
                >
                  {label}
                </th>
                {measured.map(({ group, rows }) => {
                  const cell = rows[row];
                  return (
                    <td key={group.label} className="py-1.5 pl-4 text-sm text-ink">
                      <span className={cell.measure ? 'measure' : undefined}>
                        {cell.value}
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
          sentence stays a sentence. Named per group only when the groups
          differ: two responses that got the same word produce the same
          sentence twice, and labelling each copy suggests something told them
          apart. */}
      <ul className="mt-3 space-y-1">
        {shapeNotes(measured).map(({ key, prefix, shape }) => (
          <li key={key} className="text-xs leading-relaxed text-ink-muted">
            {prefix && <span className="text-ink-faint">{prefix}: </span>}
            <span className="text-ink">{shape.label}</span> &#8212; glucose{' '}
            {shape.description}.
          </li>
        ))}
      </ul>

      {caveats.length > 0 && (
        <div className="mt-3 max-w-[52ch] space-y-1">
          {caveats.map(({ group, caveat }) => (
            <p key={group.label} className="text-xs leading-relaxed text-ink-muted">
              {comparing && <span className="text-ink-faint">{group.label}: </span>}
              {caveat}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

function shapeNotes(measured: Measured[]) {
  const shapes = measured.map((m) => m.group.postMeal?.shape ?? '');
  const distinct = new Set(shapes);

  if (distinct.size === 1) {
    const shape = postMealShapeLabel(shapes[0]);
    return [{ key: shape.label, prefix: null, shape }];
  }

  return measured.map(({ group }, i) => ({
    key: group.label,
    prefix: group.label,
    shape: postMealShapeLabel(shapes[i]),
  }));
}
