'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { Experiment } from '@wellovue/types';
import { AppShell } from '@/components/AppShell';
import { ExperimentState } from '@/components/ExperimentState';
import { useCurrentUser, useSession } from '@/hooks/useAuth';
import { api } from '@/lib/api';

/**
 * Experiments proposed, what the safety rules said about each, and where each
 * one got to.
 *
 * A list and nothing more. Starting one and recording its result both live on
 * the experiment's own page, because starting is the first irreversible thing
 * anybody does here — the trial cannot afterwards be deleted, and neither can
 * the prediction written when it begins. That belongs on the screen that shows
 * what follows from it, not behind a button in a row.
 */

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
            They start on the Evidence screen: a finding that a week of
            alternating behaviour could settle offers a test for itself. Every
            proposal is checked against your care profile before anything
            starts, and some are refused outright — changing an insulin dose is
            not something Wellovue will ever help plan.
          </p>
          <Link
            href="/evidence"
            className="mt-4 inline-block text-sm text-ink underline underline-offset-4"
          >
            See what your data supports
          </Link>
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
    <li>
      {/* The whole card is the link. A refused experiment leads somewhere too:
          the page is where the refusal is explained, and an unclickable row
          would leave the one answer people most want a reason for as a badge
          and nothing else. */}
      <Link
        href={`/experiments/${experiment.id}`}
        className="block border border-rule bg-paper-raised p-5 transition-colors hover:bg-paper-sunk"
      >
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <p className="max-w-md text-sm text-ink">{experiment.title}</p>
          <ExperimentState experiment={experiment} />
        </div>

        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
          {experiment.question}
        </p>

        {experiment.clinicianReviewRequired && (
          <p className="mt-4 border-t border-rule pt-4 text-sm text-ink-muted">
            Waiting on a clinician to look at it. Nothing starts until they do.
          </p>
        )}
      </Link>
    </li>
  );
}
