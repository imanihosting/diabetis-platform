import { CARE_BOUNDARY } from '@/lib/navigation';
import { cn } from '@/lib/cn';

/**
 * What the platform will not do, given a heading and a readable size.
 *
 * This text used to sit at the bottom of the footer in the smallest type on
 * the page, in the faintest ink, unlabelled: the exact visual treatment a
 * reader has been trained to skip. That is the wrong shape for it. PRODUCT.md
 * puts it plainly, and it is worth repeating here because it decides the
 * markup: the safety boundary is a reason to trust this product, not a
 * disclaimer to bury.
 *
 * So it gets a heading, body-sized type, and the muted ink used for prose
 * rather than the faint ink used for metadata. It reads as something the
 * product wanted to say.
 */
export function CareBoundary({ className }: { className?: string }) {
  return (
    <section
      aria-labelledby="care-boundary"
      className={cn('border-t border-rule pt-6', className)}
    >
      <h2
        id="care-boundary"
        className="text-xs font-semibold uppercase tracking-[0.09em] text-ink"
      >
        {CARE_BOUNDARY.title}
      </h2>
      <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-ink-muted">
        {CARE_BOUNDARY.body}
      </p>
    </section>
  );
}
