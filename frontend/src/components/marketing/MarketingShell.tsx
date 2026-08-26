'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Disclosure } from '@/components/Disclosure';
import { MARKETING_NAV, isCurrent } from '@/lib/navigation';

/**
 * Header and footer for every public page.
 *
 * The nav sits inline from the medium breakpoint up and behind a disclosure
 * below it: four items plus an action will not fit on a 360px phone without
 * shrinking the type past the legibility floor the rest of the page holds to.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="brand flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-7 py-5 sm:px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-[var(--brand-ink)]"
        >
          Diabetes Platform
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-8 md:flex">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
              className={
                isCurrent(pathname, item.href)
                  ? 'text-sm text-[var(--brand-ink)] underline decoration-1 underline-offset-[6px]'
                  : 'text-sm text-[var(--brand-ink-2)] underline-offset-[6px] hover:text-[var(--brand-ink)] hover:underline'
              }
            >
              {item.label}
            </Link>
          ))}

          <Link
            href="/login"
            className="text-sm font-medium text-[var(--brand-ink)] underline-offset-[6px] hover:underline"
          >
            Sign in
          </Link>
        </nav>

        <div className="md:hidden">
          <Disclosure
            label="Menu"
            openLabel="Close"
            triggerClassName="text-sm font-medium text-[var(--brand-ink)] underline-offset-4 hover:underline"
            panelClassName="w-[min(17rem,calc(100vw-3.5rem))] border border-[var(--brand-rule)] bg-[var(--paper-raised)] p-2 shadow-[0_18px_40px_-28px_rgb(0_0_0/0.5)]"
          >
            {(close) => (
              <nav aria-label="Main" className="flex flex-col">
                {MARKETING_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                    className={
                      isCurrent(pathname, item.href)
                        ? 'px-3 py-2.5 text-sm font-medium text-[var(--brand-ink)]'
                        : 'px-3 py-2.5 text-sm text-[var(--brand-ink-2)] hover:text-[var(--brand-ink)]'
                    }
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/login"
                  onClick={close}
                  className="mt-1 border-t border-[var(--brand-rule)] px-3 pb-2 pt-3 text-sm font-medium text-[var(--brand-ink)]"
                >
                  Sign in
                </Link>
              </nav>
            )}
          </Disclosure>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--brand-rule)] py-10">
        <div className="mx-auto max-w-6xl px-7 sm:px-6">
          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3">
            {MARKETING_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-[var(--brand-ink-2)] underline-offset-4 hover:text-[var(--brand-ink)] hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-8 flex flex-col gap-4 text-xs leading-relaxed text-[var(--brand-ink-3)] sm:flex-row sm:justify-between">
            <p className="max-w-[62ch]">
              For understanding your own patterns and preparing for appointments.
              Not a medical device, and not a substitute for professional care.
              Always speak to your clinician before changing anything about your
              treatment.
            </p>
            <p className="shrink-0">&#169; {new Date().getFullYear()}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
