import {
  dataQualityHeadline,
  dataQualityMeasurements,
  type DataQuality,
} from '@wellovue/types';
import { Disclosure } from '@/components/Disclosure';

/**
 * How complete the record behind a finding is.
 *
 * Placed with the qualifications rather than with the numbers, because that is
 * what it is: the evidence badge above already carries the consequence — a
 * finding on a partial record cannot be called strong, whatever its sample
 * count — and this is the reason for it.
 *
 * The headline is always visible and the figures are one disclosure away. A
 * reader deciding whether to trust a finding needs the coverage number; the
 * longest gap and the sampling interval are for the reader who has decided the
 * number is interesting, and putting all six on every card would bury the one
 * that matters under five that usually do not.
 *
 * Rows come from `dataQualityMeasurements()` in the shared contract, because
 * the clinician packet shows the same figures and the two must not name them
 * differently.
 */
export function DataQualityPanel({ quality }: { quality: DataQuality | null }) {
  if (!quality) return null;

  const rows = dataQualityMeasurements(quality);

  return (
    <div className="border-t border-rule pt-4 [&+&]:mt-6">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">
        How complete this record is
      </h4>

      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-ink-muted">
        {dataQualityHeadline(quality)}
      </p>

      <div className="mt-2">
        <Disclosure
          label="The record behind this"
          triggerClassName="text-xs text-ink-faint transition-colors hover:text-ink-muted"
          panelClassName="surface-sunk mt-2 px-4 py-3 w-[min(22rem,100%)]"
        >
          {() => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {rows.map((row) => (
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
