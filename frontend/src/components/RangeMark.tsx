import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * The Wellovue mark: a glucose trace settling into its target band.
 *
 * Not an invented logo. It is a miniature of the chart the product draws
 * everywhere else, down to the tokens: `--in-range-wash` for the band,
 * `--in-range` for its upper bound, `--ink` for the trace. A reader who has
 * seen one day of their own data has already been taught how to read it.
 *
 * This is the one place on the chrome where the range colour appears, and it
 * earns it: the colour here means exactly what it means in every chart, which
 * is the test PRODUCT.md sets. The nav's active marker deliberately does not
 * use it, because a coloured underline would mean nothing.
 *
 * Two constraints shaped the drawing. It has to survive greyscale, because
 * these pages get printed and handed to a clinician, so the band is a pale
 * wash and the trace is near-black rather than two hues of similar lightness.
 * And it has to hold together at 16px, which rules out the real 96-point
 * curve: five points carry the same story and stay legible.
 */
export function RangeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 16"
      className={cn('h-4 w-7 shrink-0', className)}
      aria-hidden
      focusable="false"
    >
      {/* The target band, drawn as ground rather than as an overlay. It takes
          the lower half of the frame so it reads as a band at 16px; a thinner
          one collapses into a coloured underline. */}
      <rect x="0" y="7" width="28" height="9" fill="var(--in-range-wash)" />
      <line
        x1="0"
        x2="28"
        y1="7"
        y2="7"
        stroke="var(--in-range)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
        opacity="0.7"
      />
      {/* Above range, then settling into it: the shape of a day that got
          worked out. Both ends sit inside the frame, so the trace reads as a
          drawn object rather than as a line clipped by the edge. */}
      <path
        d="M 1.5 5.2 L 6 2 L 11 9 L 16.5 11.6 L 21.5 10.2 L 26.5 10.8"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Mark plus name, as one link home.
 *
 * Both shells and the sign-in page use this, so the product cannot introduce
 * itself three slightly different ways.
 */
export function Wordmark({
  href = '/',
  className,
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex items-center gap-2.5 text-[0.95rem] font-semibold tracking-tight text-ink',
        className,
      )}
    >
      <RangeMark className="transition-opacity group-hover:opacity-80" />
      Wellovue
    </Link>
  );
}
