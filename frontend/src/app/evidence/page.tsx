'use client';

import { useState } from 'react';
import {
  findingStrength,
  profileNeedsSetup,
  requiresInsulinBoundary,
  type PatternResponse,
  type StructuredFinding,
} from '@wellovue/types';
import { AppShell } from '@/components/AppShell';
import { FindingCard } from '@/components/FindingCard';
import { UnsupportedCareMode } from '@/components/UnsupportedCareMode';
import { InsulinBoundary } from '@/components/InsulinBoundary';
import { useEvidence } from '@/hooks/useEvidence';
import { useDiabetesProfile } from '@/hooks/useDiabetesProfile';
import { useCurrentUser } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * The Evidence surface.
 *
 * Structured findings from the metabolic engine, by way of `GET /api/evidence`.
 * The shape is the product promise, not a layout choice: summary, effect,
 * evidence strength, limitations, and what would sharpen the answer.
 *
 * Findings the data cannot yet support are shown, not hidden. "Not enough
 * data, and here is what to log" is a real answer, and a screen that quietly
 * dropped those would look more certain than the data is.
 */

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export default function EvidencePage() {
  const [days, setDays] = useState(30);
  const user = useCurrentUser();
  const evidence = useEvidence(days);
  const profile = useDiabetesProfile();

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
            Sign in to see your evidence
          </a>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">Evidence</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            What your data suggests, how strongly, and what would make each
            answer sharper.
          </p>
        </div>

        <div className="flex gap-1 border border-rule p-0.5" role="group">
          {PERIODS.map((period) => (
            <button
              key={period.days}
              type="button"
              onClick={() => setDays(period.days)}
              aria-pressed={days === period.days}
              className={cn(
                'rounded px-3 py-1 text-xs transition-colors',
                days === period.days
                  ? 'bg-paper-sunk text-ink'
                  : 'text-ink-faint hover:text-ink-muted',
              )}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {evidence.isPending && (
        <p className="text-sm text-ink-faint" role="status">
          Reading your {days} days of data…
        </p>
      )}

      {evidence.isError && (
        <EngineError error={evidence.error} onRetry={() => void evidence.refetch()} />
      )}

      {evidence.data && (
        <Findings
          response={evidence.data}
          days={days}
          needsSetup={
            profile.data ? profileNeedsSetup(profile.data.profile) : false
          }
          insulinBoundary={
            profile.data
              ? requiresInsulinBoundary(
                  profile.data.profile.careMode,
                  profile.data.activeFlags,
                )
              : false
          }
        />
      )}
    </AppShell>
  );
}

function Findings({
  response,
  days,
  needsSetup,
  insulinBoundary,
}: {
  response: PatternResponse;
  days: number;
  needsSetup: boolean;
  insulinBoundary: boolean;
}) {
  // The gate answers with exactly one finding and nothing else, so this is the
  // whole screen rather than a card among others.
  const gated = response.findings.find(
    (f) => f.findingType === 'care_mode_unsupported',
  );
  if (gated) {
    return <UnsupportedCareMode finding={gated} needsSetup={needsSetup} />;
  }

  // Nothing was measured at all — every question came back with a count of
  // zero. Checked on the sample counts rather than on a detector's name so
  // this does not break the first time the engine adds a detector.
  const nothingLogged =
    response.findings.length === 0 ||
    response.findings.every((f) => f.sampleCount === 0);

  if (nothingLogged) {
    return <NothingLogged response={response} days={days} />;
  }

  const supported: StructuredFinding[] = [];
  const unsupported: StructuredFinding[] = [];

  for (const finding of response.findings) {
    // Already ordered by the API, so filtering here keeps that order within
    // each group rather than imposing a second one.
    (findingStrength(finding) === 'insufficient' ? unsupported : supported).push(finding);
  }

  return (
    <div className="space-y-10">
      {/* Before the findings, so it frames them rather than qualifying a
          conclusion the reader has already drawn. */}
      {insulinBoundary && <InsulinBoundary />}

      {supported.length > 0 && (
        <Group findings={supported} />
      )}

      {unsupported.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-ink">Not enough data yet</h2>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            {supported.length > 0
              ? 'These questions were asked of your data and could not be answered from it. What each one needs is listed underneath.'
              : 'Every question the engine asked of the last ' +
                days +
                ' days needs more data before it can be answered. What each one needs is listed underneath.'}
          </p>
          <div className="mt-4">
            <Group findings={unsupported} />
          </div>
        </section>
      )}

      <Provenance response={response} />
    </div>
  );
}

/**
 * The state a new account lands in.
 *
 * Still an answer, not an error: the questions were asked and the data could
 * not support them. The engine's own suggestions are shown rather than
 * reworded, and the one thing missing from them — a way to get to the page
 * that fixes it — is added.
 */
function NothingLogged({ response, days }: { response: PatternResponse; days: number }) {
  const suggestions = [
    ...new Set(response.findings.flatMap((f) => f.wouldImproveWith)),
  ];

  return (
    <div className="border border-dashed border-rule px-6 py-10">
      <p className="text-sm text-ink">
        There are no readings in the last {days} days, so there is nothing to
        assess yet.
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Findings are computed from your own records. Nothing is assumed about
        you until there is something to compute from.
      </p>

      {suggestions.length > 0 && (
        <ul className="mt-4 space-y-1">
          {suggestions.map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
              <span aria-hidden className="text-ink-faint">
                &#8213;
              </span>
              {item}
            </li>
          ))}
        </ul>
      )}

      <a
        href="/log"
        className="mt-5 inline-block text-sm text-ink underline underline-offset-4"
      >
        Log a reading
      </a>
    </div>
  );
}

function Group({ findings }: { findings: StructuredFinding[] }) {
  return (
    <div className="space-y-4">
      {findings.map((finding, index) => (
        // The engine emits one finding per detector, so the type is unique in
        // practice — the index keeps the key correct if that ever stops
        // being true rather than silently dropping a card.
        <FindingCard key={`${finding.findingType}-${index}`} finding={finding} />
      ))}
    </div>
  );
}

/**
 * Which model produced this, and when.
 *
 * Not decoration. A finding that cannot be traced back to a version of a model
 * and a moment in time is not evidence, and this is the line a reader quotes
 * when a finding and their clinician disagree.
 */
function Provenance({ response }: { response: PatternResponse }) {
  const generatedAt = new Date(response.generatedAt);

  return (
    <p className="border-t border-rule pt-4 text-xs leading-relaxed text-ink-faint">
      Produced by <span className="measure">{response.modelVersion}</span> on{' '}
      <time dateTime={generatedAt.toISOString()}>
        {generatedAt.toLocaleString(undefined, {
          dateStyle: 'long',
          timeStyle: 'short',
        })}
      </time>
      . Findings come from a statistical model over your own records, never from
      a language model, and describe association rather than cause.
    </p>
  );
}

function EngineError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const unreachable = error instanceof ApiError && error.status === 503;

  return (
    <div className="border border-rule px-6 py-8">
      <p className="text-sm text-ink">
        {unreachable
          ? 'Your findings could not be produced just now.'
          : 'Your findings could not be loaded.'}
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        {error instanceof Error
          ? error.message
          : 'An unexpected error occurred.'}
      </p>
      {unreachable && (
        <p className="mt-2 max-w-prose text-sm text-ink-faint">
          Everything you have logged is safe. Findings are recomputed from your
          records each time this page loads, so nothing was lost.
        </p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 border border-rule px-3 py-1.5 text-sm text-ink transition-colors hover:bg-paper-sunk"
      >
        Try again
      </button>
    </div>
  );
}
