'use client';

import { AppShell } from '@/components/AppShell';
import { EvidenceBadge } from '@/components/EvidenceBadge';

/**
 * The Evidence surface.
 *
 * This is where structured findings from the metabolic engine will land. The
 * shape is fixed now — summary, effect, evidence strength, limitations, and
 * what would sharpen the answer — because that shape is the product promise,
 * not a layout detail. The wiring to /patterns/detect comes with Phase 2.
 */
export default function EvidencePage() {
  return (
    <AppShell>
      <h1 className="text-xl font-medium tracking-tight text-ink">Evidence</h1>
      <p className="mt-1 text-sm text-ink-muted">
        What your data suggests, how strongly, and what would make each answer
        sharper.
      </p>

      <div className="mt-8 border border-dashed border-rule px-6 py-10">
        <p className="text-sm text-ink-muted">
          The pattern engine is running but is not yet connected to this screen.
        </p>
        <p className="mt-2 text-sm text-ink-faint">
          When it is, each finding will appear in the shape below — never as a
          bare recommendation.
        </p>

        <FindingPreview />
      </div>
    </AppShell>
  );
}

/** A worked example of the finding shape, so the contract is legible in the UI. */
function FindingPreview() {
  const finding = {
    summary:
      'Meals followed by activity within 90 minutes were associated with a 1.1 mmol/L lower glucose rise.',
    effectEstimate: -1.1,
    effectUnit: 'mmol/L difference in glucose rise',
    confidence: 0.85,
    sampleCount: 156,
    limitations: [
      'This is an observed association, not a controlled comparison',
      'Meals in the two groups were not matched for size or composition',
      'Activity intensity and duration were not accounted for',
    ],
    wouldImproveWith: [
      'Run a Living Trial: the same meal, alternating a walk and no walk',
      'Record how long and how briskly you walked',
    ],
  };

  return (
    <article className="mt-6 border border-rule bg-paper-raised p-5 opacity-70">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-md text-sm text-ink">{finding.summary}</p>
        <EvidenceBadge
          sampleCount={finding.sampleCount}
          confidence={finding.confidence}
        />
      </div>

      <p className="measure mt-4 text-reading-sm font-medium text-ink">
        {finding.effectEstimate}
        <span className="ml-2 font-sans text-xs font-normal text-ink-faint">
          {finding.effectUnit}
        </span>
      </p>

      <Section title="What this does not account for" items={finding.limitations} />
      <Section title="What would sharpen this" items={finding.wouldImproveWith} />
    </article>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-5 border-t border-rule pt-4">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">{title}</h4>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-ink-muted">
            <span aria-hidden className="text-ink-faint">
              —
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
