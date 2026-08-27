import type { StructuredFinding } from '@wellovue/types';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { ProposeExperiment } from '@/components/ProposeExperiment';

/**
 * One finding, exactly as the engine returned it.
 *
 * The effect estimate is not the point; the two lists underneath it are. A
 * product that states what it does not know is making a claim you can check,
 * and that is the difference between evidence and advice. Nothing here is
 * phrased by the app — the summary, the limitations and the suggestions are
 * the engine's own words, and the app only decides where they sit.
 *
 * The action to test a finding sits at the bottom, on the minority of
 * findings that have one. See ProposeExperiment.
 *
 * The effect estimate is deliberately not coloured. Colour in this product
 * means one of two things: where a glucose value sits relative to target, or
 * how far a finding can be trusted. An effect estimate is neither — for one
 * finding a negative number is an improvement, for another it is simply a
 * lower average — so tinting it would teach the reader a rule that is wrong
 * half the time. The badge carries the only colour on the card.
 */
export function FindingCard({ finding }: { finding: StructuredFinding }) {
  return (
    <article className="border border-rule bg-paper-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {/* The engine's own name for the check. Kept visible because it is
            what a clinician would quote back, and what a future report keys
            findings by. */}
        <span className="measure text-xs text-ink-faint">{finding.findingType}</span>
        <EvidenceBadge finding={finding} />
      </div>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink">
        {finding.summary}
      </p>

      {finding.effectEstimate !== null && (
        <p className="mt-4 text-reading-sm font-medium text-ink">
          <span className="measure">{formatEffect(finding.effectEstimate)}</span>
          {finding.effectUnit && (
            <span className="ml-2 font-sans text-xs font-normal text-ink-faint">
              {finding.effectUnit}
            </span>
          )}
        </p>
      )}

      {finding.clinicianReviewRecommended && (
        <p className="mt-4 border-l-2 border-rule pl-3 text-sm leading-relaxed text-ink-muted">
          Worth raising with your clinician. This is a pattern a professional
          should look at — it is not a diagnosis, and nothing here changes
          treatment.
        </p>
      )}

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

      {/* Last, after the limitations. Somebody deciding whether to spend a week
          testing this should read what it does not account for first. */}
      <ProposeExperiment finding={finding} />
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
    <div className="mt-5 border-t border-rule pt-4">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">{title}</h4>
      <ul className="mt-2 space-y-1">
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
