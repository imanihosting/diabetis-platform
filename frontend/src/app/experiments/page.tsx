'use client';

import { useQuery } from '@tanstack/react-query';
import type { Experiment, SafetyStatus } from '@wellovue/types';
import { AppShell } from '@/components/AppShell';
import { useCurrentUser, useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Experiments proposed, and what the safety rules said about each.
 *
 * Read-only, and deliberately so. The endpoint that proposes one exists and
 * applies the safety decision; nothing in the app calls it yet. Shipping the
 * surface that shows the decision before the surface that asks for it is the
 * right order: the thing worth getting right first is what a refusal looks
 * like, and a refusal is the one outcome a person cannot argue with and should
 * still understand.
 */

const LABELS: Record<SafetyStatus, string> = {
  allowed: 'Ready to start',
  clinician_gated: 'Needs a clinician',
  blocked: 'Wellovue will not run this',
};

/**
 * The same reasoning as EvidenceBadge: the colour is never the only signal,
 * and the words carry the meaning on their own in print and in greyscale.
 */
const STYLES: Record<SafetyStatus, string> = {
  allowed:
    'border-[color-mix(in_oklch,var(--evidence-strong)_45%,transparent)] text-evidence-strong',
  clinician_gated:
    'border-[color-mix(in_oklch,var(--evidence-weak)_45%,transparent)] text-evidence-weak',
  blocked:
    'border-[color-mix(in_oklch,var(--below-range-text)_45%,transparent)] text-zone-belowText',
};

export default function ExperimentsPage() {
  const user = useCurrentUser();
  const { ready } = useSession();

  const experiments = useQuery({
    queryKey: ['experiments'],
    queryFn: () => api.experiments.list(),
    enabled: ready,
  });

  if (user.isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-faint">Loading…</p>
      </AppShell>
    );
  }

  if (user.isError || !user.data) {
    return (
      <AppShell>
        <div className="border border-rule px-6 py-10 text-center">
          <p className="text-ink">You are not signed in.</p>
          <a
            href="/login"
            className="mt-3 inline-block text-sm text-ink underline underline-offset-4"
          >
            Sign in to see your experiments
          </a>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="text-xl font-medium tracking-tight text-ink">Experiments</h1>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted">
        A finding describes what already happened. An experiment is how you
        find out whether it happens on purpose.
      </p>

      {experiments.isPending && (
        <p className="mt-8 text-sm text-ink-faint" role="status">
          Loading…
        </p>
      )}

      {experiments.data?.length === 0 && (
        <div className="mt-8 border border-dashed border-rule px-6 py-10">
          <p className="text-sm text-ink">You have not proposed an experiment yet.</p>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
            Proposing one from here is still being built. When it arrives, every
            proposal will be checked against your care profile before anything
            starts, and some will be refused outright — changing an insulin dose
            is not something Wellovue will ever help plan.
          </p>
        </div>
      )}

      {experiments.data && experiments.data.length > 0 && (
        <ul className="mt-8 space-y-4">
          {experiments.data.map((experiment) => (
            <ExperimentRow key={experiment.id} experiment={experiment} />
          ))}
        </ul>
      )}
    </AppShell>
  );
}

function ExperimentRow({ experiment }: { experiment: Experiment }) {
  return (
    <li className="border border-rule bg-paper-raised p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="max-w-md text-sm text-ink">{experiment.title}</p>
        <span
          className={cn(
            'inline-flex items-center border px-2 py-0.5 text-xs font-medium',
            STYLES[experiment.safetyStatus],
          )}
        >
          {LABELS[experiment.safetyStatus]}
        </span>
      </div>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
        {experiment.question}
      </p>

      {experiment.clinicianReviewRequired && (
        <p className="mt-4 border-t border-rule pt-4 text-sm text-ink-muted">
          Waiting on a clinician to look at it. Nothing starts until they do.
        </p>
      )}
    </li>
  );
}
