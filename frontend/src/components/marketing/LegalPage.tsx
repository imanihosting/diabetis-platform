import type { ReactNode } from 'react';
import { MarketingShell } from './MarketingShell';

/**
 * Layout for the policy pages.
 *
 * Narrower measure than the rest of the site and a visible last-updated date,
 * because these are documents people read closely and occasionally need to
 * cite a version of.
 */
export function LegalPage({
  title,
  updated,
  summary,
  children,
}: {
  title: string;
  updated: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <MarketingShell>
      <header className="mx-auto max-w-3xl px-7 pb-8 pt-[clamp(1.5rem,4vw,3rem)] sm:px-6">
        <h1 className="text-fold font-semibold text-balance">{title}</h1>
        <p className="measure mt-4 text-sm text-[var(--ink-faint)]">
          Last updated {updated}
        </p>
        <p className="mt-6 max-w-[62ch] text-lede text-[var(--ink-muted)]">
          {summary}
        </p>
      </header>

      <div className="mx-auto max-w-3xl px-7 pb-[clamp(3rem,7vw,5rem)] sm:px-6">
        {children}
      </div>
    </MarketingShell>
  );
}

/** A numbered clause. The heading is the claim; the body qualifies it. */
export function Clause({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--rule)] py-8">
      <h2 className="flex items-baseline gap-3 text-lede font-semibold text-[var(--ink)]">
        <span className="measure text-sm text-[var(--ink-faint)]">
          {String(n).padStart(2, '0')}
        </span>
        {title}
      </h2>
      <div className="mt-4 max-w-[68ch] space-y-4 leading-relaxed text-[var(--ink-muted)] [&_a]:text-[var(--ink)] [&_a]:underline [&_a]:underline-offset-4 [&_li]:flex [&_li]:gap-2.5 [&_ul]:mt-3 [&_ul]:space-y-2">
        {children}
      </div>
    </section>
  );
}

/** A list marker that stays legible in greyscale and never carries meaning alone. */
export function Bullet() {
  return (
    <span aria-hidden className="text-[var(--ink-faint)]">
      &#8213;
    </span>
  );
}
