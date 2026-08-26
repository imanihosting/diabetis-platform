import type { ReactNode } from 'react';

/**
 * One idea, one fold.
 *
 * The eyebrow is a number, not a word: the page is a sequence, and numbering
 * it says so without a progress bar. Asymmetric by default — the statement
 * column is narrower than the evidence beside it, so the reader's eye has
 * somewhere to go.
 */
export function Fold({
  index,
  eyebrow,
  heading,
  children,
  aside,
}: {
  index: number;
  eyebrow: string;
  heading: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--rule)] py-[clamp(3.5rem,9vw,8rem)]">
      <div className="mx-auto max-w-6xl px-7 sm:px-6">
        <div className="grid gap-x-16 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="flex items-baseline gap-3 text-sm text-[var(--ink-faint)]">
              <span className="measure">{String(index).padStart(2, '0')}</span>
              <span>{eyebrow}</span>
            </p>
            <h2 className="mt-5 text-fold font-semibold text-balance">{heading}</h2>
            {children && (
              <div className="mt-6 max-w-[65ch] space-y-5 text-lede text-[var(--ink-muted)]">
                {children}
              </div>
            )}
          </div>

          {aside && <div className="lg:col-span-7">{aside}</div>}
        </div>
      </div>
    </section>
  );
}
