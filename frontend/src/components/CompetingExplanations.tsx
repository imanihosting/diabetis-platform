import type { CompetingExplanation } from '@wellovue/types';

/**
 * What else could have produced this pattern.
 *
 * The step the loop always described and never had. A finding says meals
 * followed by a walk were followed by a smaller rise; those two groups of
 * meals were created by somebody living their life, and they differ in more
 * than the walk. Reporting the association without naming that is how an
 * association gets read as a cause.
 *
 * Every word here comes from the engine's reviewed catalogue. Nothing on this
 * surface composes an explanation, adds to one, or reorders them by any
 * judgement of its own — a competing explanation is a clinical claim, and the
 * frontend is the one place it must never be written.
 *
 * Each opens to say why it could produce this, what a record would look like
 * if it were true, and what is missing from this one. Collapsed by default
 * because four of these fully expanded would bury the finding they qualify;
 * the labels alone already do the important work, which is to stop the reader
 * believing there is only one explanation.
 *
 * `<details>` rather than this codebase's `Disclosure`, which is a positioned
 * popover built for menus — four of those stacked in a list would overlap each
 * other. The native element also keeps the text in the document while closed,
 * so it is there for a screen reader walking the page, for a find-in-page, and
 * for a printer.
 */
export function CompetingExplanations({
  explanations,
}: {
  explanations: CompetingExplanation[];
}) {
  if (explanations.length === 0) return null;

  return (
    <div className="border-t border-rule pt-4 [&+&]:mt-6">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">
        Other possible reasons
      </h4>

      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-ink-muted">
        This is an association in your own record, not a cause. Any of these
        could produce the same pattern.
      </p>

      <ul className="mt-3 space-y-2">
        {explanations.map((explanation) => (
          <li key={explanation.label}>
            <details className="group">
              <summary className="cursor-pointer list-none text-sm text-ink transition-colors hover:text-ink-muted">
                <span aria-hidden className="mr-2 text-ink-faint group-open:hidden">
                  +
                </span>
                <span aria-hidden className="mr-2 hidden text-ink-faint group-open:inline">
                  &#8722;
                </span>
                {explanation.label}
              </summary>

              <div className="ml-5 mt-2 max-w-[52ch] space-y-2 border-l border-rule pl-4 text-sm leading-relaxed text-ink-muted">
                <p>{explanation.why}</p>
                <p>
                  <span className="text-ink-faint">Would show up as: </span>
                  {explanation.supportedBy}
                </p>
                <p>
                  <span className="text-ink-faint">Missing here: </span>
                  {explanation.missing}
                </p>
                {/* The honest half. When the product cannot hold the data, it
                    says so rather than asking for something there is nowhere
                    to put. */}
                <p className="text-ink">
                  {explanation.capture ?? 'Wellovue cannot record this yet.'}
                </p>
              </div>
            </details>
          </li>
        ))}
      </ul>

    </div>
  );
}
