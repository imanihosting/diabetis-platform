import { findingPresentation, type StructuredFinding } from '@wellovue/types';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { FindingTrace } from '@/components/FindingTrace';
import { PostMealMeasurements } from '@/components/PostMealMeasurements';
import { ProposeExperiment } from '@/components/ProposeExperiment';
import { Disclosure } from '@/components/Disclosure';

/**
 * One finding, read as diabetes rather than as statistics.
 *
 * The engine's output has not changed shape here; what changed is which parts
 * of it a person meets first, and in what language.
 *
 * The identifier is not the title. `late_evening_meal_response` is the record's
 * name for this check and belongs in the record — a clinician quotes it and the
 * packet keys on it — but it tells somebody with diabetes nothing. The title
 * and the lens come from the shared contract, which restates what the detector
 * already measures and introduces no claim of its own.
 *
 * The qualifications are the finding, not the footnotes. What this does not
 * account for and what would sharpen it used to sit last, below an effect
 * estimate, where they read as small print under a headline. They are the
 * reason this is evidence rather than a claim, so they sit in the main column
 * at the same weight as the number.
 *
 * The p-value is not shown by default. It is a statistic, not a limitation,
 * and printing "Statistical p-value: 0.000" in a list of caveats is what made
 * this read as a lab report. It is still available, one disclosure away, for
 * the reader who wants it.
 */
export function FindingCard({ finding }: { finding: StructuredFinding }) {
  const { title, lens } = findingPresentation(finding.findingType);

  return (
    <article className="surface-raised p-[clamp(1.25rem,2.5vw,2rem)]">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-faint">{lens}</p>
          <h3 className="mt-1.5 text-reading-sm font-medium tracking-tight text-ink">
            {title}
          </h3>
        </div>
        <EvidenceBadge finding={finding} />
      </div>

      <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <div>
          <h4 className="text-xs uppercase tracking-wide text-ink-faint">
            What Wellovue saw
          </h4>
          {/* The engine's own sentence. Nothing here rewrites it. */}
          <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-ink">
            {finding.summary}
          </p>

          {finding.effectEstimate !== null && (
            <p className="mt-5 text-reading font-medium text-ink">
              <span className="measure">{formatEffect(finding.effectEstimate)}</span>
              {finding.effectUnit && (
                <span className="ml-2 font-sans text-xs font-normal text-ink-faint">
                  {finding.effectUnit}
                </span>
              )}
            </p>
          )}

          {/* Drawn from the measured baselines and peaks, against the band the
              rest of the product uses. Absent when the finding is not a
              glucose comparison, rather than drawn empty. */}
          <FindingTrace groups={finding.comparison} />

          {/* The same curve, in the numbers a person with diabetes already
              uses to describe a meal: when it peaked, how long it stayed above
              target, when it came back. Absent when the responses were not
              watched long enough to time, rather than estimated. */}
          <PostMealMeasurements groups={finding.comparison} />

          {finding.clinicianReviewRecommended && (
            <p className="mt-6 max-w-[52ch] border-t border-rule pt-4 text-sm leading-relaxed text-ink-muted">
              Worth raising with your clinician. This is a pattern a
              professional should look at — it is not a diagnosis, and nothing
              here changes treatment.
            </p>
          )}
        </div>

        <div className="max-w-[52ch]">
          <Section
            title="What this does not account for"
            items={
              finding.limitations.length > 0
                ? finding.limitations
                : // The contract says this list is never empty. If it is, the
                  // finding arrived unqualified, and saying so is more honest
                  // than rendering a bare claim with nothing beneath it.
                  ['The engine returned no limitations for this finding. Treat it with caution.']
            }
          />

          {finding.wouldImproveWith.length > 0 && (
            <Section title="What would sharpen this" items={finding.wouldImproveWith} />
          )}

          {/* Last, after the limitations. Somebody deciding whether to spend a
              week testing this should read what it does not account for
              first. */}
          <ProposeExperiment finding={finding} />

          {finding.pValue !== null && (
            <div className="mt-6 border-t border-rule pt-4">
              <Disclosure
                label="Technical detail"
                triggerClassName="text-xs text-ink-faint transition-colors hover:text-ink-muted"
                panelClassName="surface-sunk mt-2 px-4 py-3 w-[min(20rem,100%)]"
              >
                {() => (
                  <p className="text-xs leading-relaxed text-ink-muted">
                    Two-sided p-value{' '}
                    <span className="measure">{finding.pValue?.toFixed(3)}</span>. This is
                    how unlikely a difference this large would be if there were no real
                    difference at all. It says nothing about how large the effect is, or
                    whether it matters for you.
                  </p>
                )}
              </Disclosure>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Keeps the sign. "1.1" and "-1.1" are different findings, and the summary
 * sentence above states the direction in words, so the two must agree.
 */
function formatEffect(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    // Flush at the top of a column, spaced when stacked after a sibling.
    <div className="border-t border-rule pt-4 [&+&]:mt-6">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">{title}</h4>
      <ul className="mt-2.5 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
            <span aria-hidden className="text-ink-faint">
              &#8213;
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
