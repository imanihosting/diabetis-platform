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
 * Proposing is the whole action here, and deliberately still is. Nothing on
 * this screen starts an experiment or records a prediction: starting is the
 * first irreversible thing anybody does in this product, and it belongs on the
 * experiment's own page, next to what it commits you to. This one leads there.
 */
export function ProposeExperiment({ finding }: { finding: StructuredFinding }) {
  const proposal = proposalFromFinding(finding);
  const propose = useProposeExperiment();

  if (!proposal) return null;

  if (propose.data) {
    return (
      <Decision
        decision={propose.data.decision}
        experimentId={propose.data.experiment.id}
      />
    );
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
        className="btn btn-secondary mt-4 min-h-[2.75rem] px-5 text-sm"
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
function Decision({
  decision,
  experimentId,
}: {
  decision: ExperimentDecision;
  experimentId: string;
}) {
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
          It is saved as a draft. Starting it writes down what Wellovue expects
          to happen before you begin, and that cannot be edited afterwards —
          which is why the button for it sits on the experiment’s own page,
          beside what it commits you to.
        </p>
      )}

      <Link
        href={`/experiments/${experimentId}`}
        className="mt-3 inline-block text-sm text-ink underline underline-offset-4"
      >
        {decision.canStart ? 'Open it and read what starting does' : 'Open it'}
      </Link>
    </section>
  );
}
