import { evidenceStrength, type EvidenceStrength } from '@wellovue/types';
import { cn } from '@/lib/cn';

const STYLES: Record<EvidenceStrength, string> = {
  insufficient: 'border-evidence-insufficient/40 text-evidence-insufficient',
  weak: 'border-evidence-weak/40 text-evidence-weak',
  moderate: 'border-evidence-moderate/40 text-evidence-moderate',
  strong: 'border-evidence-strong/40 text-evidence-strong',
};

const LABELS: Record<EvidenceStrength, string> = {
  insufficient: 'Not enough data',
  weak: 'Weak evidence',
  moderate: 'Moderate evidence',
  strong: 'Strong evidence',
};

/**
 * How much a finding can be trusted, stated in words rather than a number.
 *
 * The strength is computed by `evidenceStrength()` in the shared contract, the
 * same function the API and the clinician report use, so the three surfaces
 * can never disagree about how firm a finding is.
 */
export function EvidenceBadge({
  sampleCount,
  confidence,
  className,
}: {
  sampleCount: number;
  confidence: number;
  className?: string;
}) {
  const strength = evidenceStrength(sampleCount, confidence);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-sm border px-2 py-0.5 text-xs font-medium',
        STYLES[strength],
        className,
      )}
    >
      {LABELS[strength]}
      <span className="tabular opacity-70">n={sampleCount}</span>
    </span>
  );
}
