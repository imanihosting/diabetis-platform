'use client';

import type { TimelineEntry } from '@wellovue/types';
import { Provenance } from './Provenance';
import { GlucoseValue } from './GlucoseValue';
import { DayGlucoseStrip } from './DayGlucoseStrip';
import { cn } from '@/lib/cn';

/**
 * The metabolic timeline — the product's primary surface.
 *
 * Rendered as one continuous vertical stream rather than a grid of cards,
 * because the point is the sequence: what happened, in what order, and what
 * followed. Cards would break the thing that carries the meaning.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="border border-dashed border-rule px-6 py-12 text-center">
        <p className="text-ink-muted">Nothing recorded in this period yet.</p>
        <p className="mt-1 text-sm text-ink-faint">
          Add a glucose reading, log a meal, or import a device export to start
          your timeline.
        </p>
      </div>
    );
  }

  const days = groupByDay(entries);

  return (
    <div className="space-y-8">
      {days.map(([day, dayEntries]) => {
        const glucose = dayEntries.filter((e) => e.eventType === 'glucose_sample');
        const events = dayEntries.filter((e) => e.eventType !== 'glucose_sample');

        // A handful of manual fingersticks belong in the stream; a day of CGM
        // readings does not — it becomes the strip above it.
        const dense = glucose.length > DENSE_GLUCOSE_THRESHOLD;
        const streamed = dense ? events : dayEntries;

        return (
        <section key={day}>
          <h3 className="sticky top-0 z-10 bg-[color-mix(in_oklch,var(--paper)_90%,transparent)] py-2 text-sm font-medium text-ink-muted backdrop-blur">
            {formatDay(day)}
          </h3>

          {dense && <DayGlucoseStrip entries={glucose} />}

          <ol className="relative ml-2 border-l border-rule">
            {streamed.map((entry) => (
              <li key={entry.id} className="relative py-3 pl-6">
                <span
                  aria-hidden
                  className={cn(
                    'absolute -left-[4.5px] top-[1.35rem] h-2 w-2 rounded-full ring-4 ring-paper',
                    entry.isInferred ? 'bg-evidence-weak':'bg-ink',
                  )}
                />

                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex items-baseline gap-3">
                    <time
                      className="measure text-xs text-ink-faint"
                      dateTime={new Date(entry.occurredAt).toISOString()}
                    >
                      {formatTime(entry.occurredAt)}
                    </time>
                    <EntryContent entry={entry} />
                  </div>

                  <Provenance source={entry.source} confidence={entry.confidence} />
                </div>
              </li>
            ))}
          </ol>

          {dense && events.length === 0 && (
            <p className="ml-2 border-l border-rule py-3 pl-6 text-sm text-ink-faint">
              No meals, medication, or activity logged on this day.
            </p>
          )}
        </section>
        );
      })}
    </div>
  );
}

/**
 * Above this many readings in a day, glucose is CGM data and belongs in the
 * strip rather than the stream. Below it, the readings are deliberate manual
 * checks and each one is worth its own line.
 */
const DENSE_GLUCOSE_THRESHOLD = 12;

function EntryContent({ entry }: { entry: TimelineEntry }) {
  if (entry.eventType === 'glucose_sample') {
    const payload = entry.payload as { value: number; unit: 'mmol/L' | 'mg/dL' };
    return <GlucoseValue value={payload.value} unit={payload.unit} />;
  }

  return (
    <span className="text-sm text-ink">{entry.label}</span>
  );
}


function groupByDay(entries: TimelineEntry[]): [string, TimelineEntry[]][] {
  const groups = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.occurredAt).toISOString().slice(0, 10);
    const list = groups.get(day) ?? [];
    list.push(entry);
    groups.set(day, list);
  }
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return 'Today';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
