import { glucoseZone, type GlucoseUnit } from '@wellovue/types';
import { cn } from '@/lib/cn';


/**
 * A glucose reading, coloured by where it sits relative to the target range.
 *
 * Colour is the only signal used, and it is paired with a text label, so the
 * meaning survives for colour-blind readers and in printed reports.
 */
export function GlucoseValue({
  value,
  unit,
  size = 'sm',
  className,
}: {
  value: number;
  unit: GlucoseUnit;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const mmol = unit === 'mmol/L' ? value : value / 18.0182;
  const band =
    glucoseZone(mmol);

  const bandStyles = {
    below: 'text-zone-belowText',
    in: 'text-zone-inText',
    above: 'text-zone-aboveText',
  } as const;

  const bandLabels = {
    below: 'below target',
    in: 'in target',
    above: 'above target',
  } as const;

  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span
        className={cn(
          'measure font-medium',
          bandStyles[band],
          size === 'lg' ? 'text-reading':'text-base',
        )}
      >
        {value}
      </span>
      <span className="text-xs text-ink-faint">{unit}</span>
      <span className="sr-only">({bandLabels[band]})</span>
    </span>
  );
}
