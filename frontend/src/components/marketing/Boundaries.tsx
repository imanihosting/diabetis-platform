const NEVER = [
  'Adjust your medication, or tell you to',
  'Calculate an insulin dose',
  'Diagnose a complication',
  'Advise you during a hypo or a hyper',
  'Tell you to stop taking something',
];

const GATED = [
  'Medication timing',
  'Fasting protocols',
  'Major diet changes',
  'Exercise changes if you carry cardiovascular risk',
];

/**
 * The safety boundary, stated plainly.
 *
 * Not fine print. For a product that reasons about a chronic condition, the
 * list of things it refuses to do is the most credible thing on the page, and
 * it is enforced in the database rather than promised in copy.
 */
export function Boundaries() {
  return (
    <div className="grid gap-x-14 gap-y-10 sm:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          Never, under any circumstances
        </h3>
        <ul className="mt-4 space-y-3">
          {NEVER.map((item) => (
            <li
              key={item}
              className="flex gap-3 text-[0.95rem] leading-relaxed text-[var(--ink-muted)]"
            >
              <span aria-hidden className="text-[var(--below-range-text)]">
                &#215;
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          Only with a clinician
        </h3>
        <ul className="mt-4 space-y-3">
          {GATED.map((item) => (
            <li
              key={item}
              className="flex gap-3 text-[0.95rem] leading-relaxed text-[var(--ink-muted)]"
            >
              <span aria-hidden className="text-[var(--above-range-text)]">
                &#8213;
              </span>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
