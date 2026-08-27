import type { Experiment, SafetyStatus } from '@wellovue/types';
import { cn } from '@/lib/cn';

/**
 * Where an experiment stands, in one label.
 *
 * Two questions are folded into one badge on purpose, because only one of them
 * is ever the live one. Before a trial starts, what matters is what the safety
 * rules said; once it is running, "Ready to start" is stale and the run state
 * is the answer.
 *
 * Declared once and used by the list and the experiment itself, so the two
 * cannot end up describing the same decision differently — which on a refusal
 * would be worse than saying nothing.
 *
 * Colour appears only where the safety rules spoke. A running or finished
 * trial is neutral ink: this product spends colour on where a glucose value
 * sits relative to target and on how far a finding can be trusted, and
 * "finished" is neither. As with EvidenceBadge, the words carry the meaning on
 * their own in print and in greyscale.
 */
const SAFETY_LABELS: Record<SafetyStatus, string> = {
  allowed: 'Ready to start',
  clinician_gated: 'Needs a clinician',
  blocked: 'Wellovue will not run this',
};

const SAFETY_STYLES: Record<SafetyStatus, string> = {
  allowed:
    'border-[color-mix(in_oklch,var(--evidence-strong)_45%,transparent)] text-evidence-strong',
  clinician_gated:
    'border-[color-mix(in_oklch,var(--evidence-weak)_45%,transparent)] text-evidence-weak',
  blocked:
    'border-[color-mix(in_oklch,var(--below-range-text)_45%,transparent)] text-zone-belowText',
};

const RUN_LABELS: Partial<Record<Experiment['status'], string>> = {
  active: 'Running',
  completed: 'Finished',
  abandoned: 'Abandoned',
};

export function ExperimentState({
  experiment,
  className,
}: {
  experiment: Pick<Experiment, 'status' | 'safetyStatus'>;
  className?: string;
}) {
  const run = RUN_LABELS[experiment.status];

  return (
    <span
      className={cn(
        'inline-flex items-center border px-2 py-0.5 text-xs font-medium',
        run ? 'border-rule text-ink-muted' : SAFETY_STYLES[experiment.safetyStatus],
        className,
      )}
    >
      {run ?? SAFETY_LABELS[experiment.safetyStatus]}
    </span>
  );
}
