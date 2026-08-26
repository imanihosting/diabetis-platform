import type { DataSource } from '@wellovue/types';
import { cn } from '@/lib/cn';

const SOURCE_LABELS: Record<DataSource, string> = {
  manual: 'Entered by you',
  csv_import: 'Imported file',
  cgm_device: 'CGM',
  glucose_meter: 'Meter',
  wearable: 'Wearable',
  apple_health: 'Apple Health',
  health_connect: 'Health Connect',
  clinician: 'Clinician',
  lab_import: 'Lab',
  inferred: 'Estimated',
};

/**
 * Where a data point came from, and whether the platform observed it or
 * inferred it.
 *
 * This is deliberately always visible rather than tucked behind a tooltip:
 * a person deciding what to trust about their own body should not have to
 * hunt for the difference between a measurement and a guess.
 */
export function Provenance({
  source,
  confidence,
  className,
}: {
  source: DataSource;
  confidence: number;
  className?: string;
}) {
  const inferred = confidence < 1 || source === 'inferred';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-ink-faint',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          inferred ? 'bg-evidence-weak' : 'bg-evidence-strong',
        )}
      />
      {SOURCE_LABELS[source] ?? source}
      {inferred && (
        <span className="tabular">
          · {Math.round(confidence * 100)}% confidence
        </span>
      )}
    </span>
  );
}
