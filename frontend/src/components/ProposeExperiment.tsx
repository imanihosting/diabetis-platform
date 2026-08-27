'use client';

import Link from 'next/link';
import {
  proposalFromFinding,
  type ExperimentDecision,
  type StructuredFinding,
} from '@wellovue/types';
import { useProposeExperiment } from '@/hooks/useProposeExperiment';
import { ApiError } from '@/lib/api';

/**
 * The step from "this is what happened" to "let us find out whether it happens
 * on purpose".
 *
 * Only appears on findings that have one, which is a minority of them. Most
 * findings describe something no week of alternating behaviour could settle,
 * and a button on those would imply the product had a plan it does not have.
 *
 * Proposing is the whole action. Nothing here starts an experiment, schedules
 * one, or records a prediction — those need machinery that does not exist yet,
 * and a button that appeared to start something would be the worst possible
 * place to overstate what the product does.
 */
export function ProposeExperiment({ finding }: { finding: StructuredFinding }) {
  const proposal = proposalFromFinding(finding);
  const propose = useProposeExperiment();

  if (!proposal) return null;

  if (propose.data) {
    return <Decision decision={propose.data.decision} />;
  }

  return (
    <div className="mt-5 border-t border-rule pt-4">
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
        {proposal.question}
      </p>

      <button
        type="button"
        onClick={() => propose.mutate(proposal)}
        disabled={propose.isPending}
        className="mt-3 min-h-[2.75rem] border border-ink-faint px-4 text-sm font-medium text-ink transition-colors hover:bg-paper-sunk disabled:opacity-60"
      >
        {propose.isPending ? 'Checking…' : 'Propose a test for this'}
      </button>

      {propose.isError && (
        <p role="alert" className="mt-3 text-sm text-zone-belowText">
          {propose.error instanceof ApiError
            ? propose.error.message
            : 'That could not be sent. Try again in a moment.'}
        </p>
      )}
    </div>
  );
}

/**
 * What the safety rules said.
 *
 * All three outcomes are stated in the same shape and the same ink. A refusal
 * is not an error and is not styled as one: the product considered a real
 * question and declined it, and dressing that in alarm colour would make it
 * read as something having gone wrong rather than as the product working.
 */
function Decision({ decision }: { decision: ExperimentDecision }) {
  const heading =
    decision.status === 'allowed'
      ? 'Proposed, and you can start it'
      : decision.status === 'clinician_gated'
        ? 'Proposed, and it needs a clinician first'
        : 'Not something Wellovue will run';

  return (
    <section className="mt-5 border-t border-rule pt-4" role="status">
      <h4 className="text-sm font-medium text-ink">{heading}</h4>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        {decision.reason}
      </p>

      {decision.canStart && (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-faint">
          Starting it, and measuring what happens against a prediction recorded
          beforehand, is still being built. For now it is saved as a draft.
        </p>
      )}

      <Link
        href="/experiments"
        className="mt-3 inline-block text-sm text-ink underline underline-offset-4"
      >
        See it with your other experiments
      </Link>
    </section>
  );
}
