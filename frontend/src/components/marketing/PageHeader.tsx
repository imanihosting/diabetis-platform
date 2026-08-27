import type { ReactNode } from 'react';

/** Opening block for a public page: eyebrow, statement, and a short lede. */
export function PageHeader({
  eyebrow,
  heading,
  children,
}: {
  eyebrow: string;
  heading: string;
  children?: ReactNode;
}) {
  return (
    <header className="mx-auto max-w-6xl px-7 pb-[clamp(2rem,5vw,3.5rem)] pt-[clamp(1.5rem,4vw,3rem)] sm:px-6">
      <p className="text-sm text-[var(--ink-faint)]">{eyebrow}</p>
      <h1 className="mt-4 max-w-[20ch] text-statement font-semibold text-balance">
        {heading}
      </h1>
      {children && (
        <div className="mt-7 max-w-[62ch] space-y-5 text-lede text-[var(--ink-muted)]">
          {children}
        </div>
      )}
    </header>
  );
}

/** A titled band of prose. Sections carry the argument; nothing is a card. */
export function Prose({
  eyebrow,
  heading,
  children,
  aside,
}: {
  eyebrow?: string;
  heading: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--rule)] py-[clamp(2.75rem,6vw,5rem)]">
      <div className="mx-auto max-w-6xl px-7 sm:px-8">
        <div className="grid gap-x-16 gap-y-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            {eyebrow && (
              <p className="text-sm text-[var(--ink-faint)]">{eyebrow}</p>
            )}
            <h2 className="mt-3 text-fold font-semibold text-balance">{heading}</h2>
          </div>

          <div className="max-w-[68ch] space-y-5 text-lede leading-relaxed text-[var(--ink-muted)] lg:col-span-7">
            {children}
            {aside}
          </div>
        </div>
      </div>
    </section>
  );
}
