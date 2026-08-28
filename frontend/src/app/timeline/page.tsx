'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Timeline } from '@/components/Timeline';
import { GlucoseSummaryPanel } from '@/components/GlucoseSummaryPanel';
import { useGlucoseSummary, useTimeline } from '@/hooks/useTimeline';
import { useCurrentUser } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

const PERIODS = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

export default function TimelinePage() {
  const [days, setDays] = useState(7);
  const user = useCurrentUser();
  const timeline = useTimeline(days);
  const summary = useGlucoseSummary(days);

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
        <div className="surface-sunk px-6 py-12 text-center">
          <p className="text-ink">You are not signed in.</p>
          <a
            href="/login"
            className="mt-3 inline-block text-sm text-ink underline underline-offset-4"
          >
            Sign in to see your timeline
          </a>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">
            Metabolic timeline
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Everything recorded, in the order it happened.
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

      {summary.data && (
        <div className="mb-8">
          <GlucoseSummaryPanel summary={summary.data} />
        </div>
      )}

      {timeline.isPending && <p className="text-sm text-ink-faint">Loading timeline…</p>}

      {timeline.isError && (
        <p className="text-sm text-zone-belowText">
          Could not load the timeline. {(timeline.error as Error).message}
        </p>
      )}

      {timeline.data && <Timeline entries={timeline.data} />}
    </AppShell>
  );
}
