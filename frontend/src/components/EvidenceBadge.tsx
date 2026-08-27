import { findingStrength, type EvidenceStrength, type StructuredFinding } from '@wellovue/types';
import { cn } from '@/lib/cn';

const STYLES: Record<EvidenceStrength, string> = {
  insufficient: 'border-[color-mix(in_oklch,var(--evidence-insufficient)_45%,transparent)] text-evidence-insufficient',
  weak: 'border-[color-mix(in_oklch,var(--evidence-weak)_45%,transparent)] text-evidence-weak',
  moderate: 'border-[color-mix(in_oklch,var(--evidence-moderate)_45%,transparent)] text-evidence-moderate',
  strong: 'border-[color-mix(in_oklch,var(--evidence-strong)_45%,transparent)] text-evidence-strong',
};

const LABELS: Record<EvidenceStrength, string> = {
  insufficient: 'Not enough data',
  weak: 'Weak evidence',
  moderate: 'Moderate evidence',
  strong: 'Strong evidence',
};

export type BadgeFinding = Pick<
  StructuredFinding,
  'effectEstimate' | 'sampleCount' | 'confidence'
>;

/**
 * How much a finding can be trusted, stated in words rather than a number.
 *
 * The strength is computed by `findingStrength()` in the shared contract, the
 * same function the API and the clinician report use, so the three surfaces
 * can never disagree about how firm a finding is. The colour is never the only
 * signal: the word beside it says the same thing, and both survive greyscale
 * printing.
 */
export function EvidenceBadge({
  finding,
  className,
}: {
  finding: BadgeFinding;
  className?: string;
}) {
  const strength = findingStrength(finding);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2  border px-2 py-0.5 text-xs font-medium',
        STYLES[strength],
        className,
      )}
    >
      {LABELS[strength]}
      <span className="measure opacity-70">n={finding.sampleCount}</span>
    </span>
  );
}
