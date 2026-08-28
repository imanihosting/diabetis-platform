import {
  EVIDENCE_BREAKDOWN_LABELS,
  dataQualityHeadline,
  dataQualityMeasurements,
  evidenceBreakdown,
  type DataQuality,
  type EvidenceStrength,
  type StructuredFinding,
} from '@wellovue/types';
import { Disclosure } from '@/components/Disclosure';

/**
 * Why the badge says what it says.
 *
 * Two different truths sit behind one word, and this is where they are kept
 * apart rather than blended. Confidence is how stable the relationship is in
 * the readings there are; coverage is how much of the period those readings
 * watched. A record can be entirely consistent about the fortnight it saw and
 * silent about the fortnight it did not, and reporting that as one middling
 * number would answer neither question.
 *
 * So both are shown, with the overall word beneath them. Somebody looking at a
 * finding marked weak deserves to know which half was weak: the pattern, or
 * the watching. Those call for completely different responses — one is "this
 * may not be real", the other is "wear the sensor for another fortnight".
 *
 * The record's own figures stay one disclosure away. A reader deciding whether
 * to trust a finding needs the coverage word; the longest gap and the sampling
 * interval are for the reader who has decided the answer is interesting.
 */

const STRENGTH_WORD: Record<EvidenceStrength, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  weak: 'Weak',
  insufficient: 'Not enough',
};

export function DataQualityPanel({ finding }: { finding: StructuredFinding }) {
  const quality: DataQuality | null = finding.dataQuality;
  if (!quality) return null;

  const breakdown = evidenceBreakdown(finding);
  const rows: [string, EvidenceStrength][] = [
    [EVIDENCE_BREAKDOWN_LABELS.signal, breakdown.signal],
    [EVIDENCE_BREAKDOWN_LABELS.coverage, breakdown.coverage ?? breakdown.signal],
    [EVIDENCE_BREAKDOWN_LABELS.overall, breakdown.overall],
  ];

  return (
    <div className="border-t border-rule pt-4 [&+&]:mt-6">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">
        How this was judged
      </h4>

      {/* Only when coverage is what held the finding back. A sentence
          explaining a cap that did not happen is noise on every card where
          nothing went wrong. */}
      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-ink-muted">
        {breakdown.note ?? dataQualityHeadline(quality)}
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([label, strength]) => (
          <div key={label} className="contents">
            <dt className="text-xs text-ink-faint">{label}</dt>
            <dd className="text-xs text-ink">{STRENGTH_WORD[strength]}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3">
        <Disclosure
          label="The record behind this"
          triggerClassName="text-xs text-ink-faint transition-colors hover:text-ink-muted"
          panelClassName="surface-sunk mt-2 px-4 py-3 w-[min(22rem,100%)]"
        >
          {() => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {dataQualityMeasurements(quality).map((row) => (
                <div key={row.key} className="contents">
                  <dt className="text-xs text-ink-faint">{row.label}</dt>
                  <dd className="text-xs text-ink">
                    <span className={row.measure ? 'measure' : undefined}>{row.value}</span>
                    {row.unit && <span className="ml-1 text-ink-faint">{row.unit}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Disclosure>
      </div>
    </div>
  );
}
