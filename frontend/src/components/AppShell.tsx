'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Disclosure } from '@/components/Disclosure';
import { Wordmark } from '@/components/RangeMark';
import { CareBoundary } from '@/components/CareBoundary';
import { APP_NAV, APP_SECONDARY_NAV, LEGAL_NAV, isCurrent } from '@/lib/navigation';
import { useLogout } from '@/hooks/useAuth';

/**
 * Chrome for the signed-in app.
 *
 * The primary row stays Timeline, Log and Evidence: that is the daily work.
 * Contact and the policy pages are reachable from a disclosure and again from
 * the footer, which is where people look for them anyway.
 *
 * Shares the public site's vocabulary and not its scale. The mark, the band
 * marking the current page and the band above the footer are the same objects
 * as on the landing page, at the density of something used every evening
 * rather than read once. A dashboard is scanned; a landing page is read.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const logout = useLogout();

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between gap-4 border-b border-rule py-5">
        <Wordmark href="/timeline" />

        <div className="flex items-center gap-6">
          <nav className="flex gap-6" aria-label="Main">
            {APP_NAV.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'text-sm transition-colors',
                    current
                      ? 'nav-band text-ink'
                      : 'nav-band nav-band-hover text-ink-faint hover:text-ink-muted',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Disclosure
            label="More"
            triggerClassName="text-sm text-ink-faint transition-colors hover:text-ink-muted"
            panelClassName="w-[min(20rem,calc(100vw-3rem))]  border border-rule bg-paper-raised p-2 shadow-[0_18px_40px_-28px_rgb(0_0_0/0.45)]"
          >
            {(close) => (
              <>
                <nav aria-label="More" className="flex flex-col">
                  {APP_SECONDARY_NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={close}
                      className="rounded px-3 py-2.5 hover:bg-paper-sunk"
                    >
                      <span className="block text-sm text-ink">{item.label}</span>
                      {item.detail && (
                        <span className="mt-0.5 block text-xs leading-snug text-ink-faint">
                          {item.detail}
                        </span>
                      )}
                    </Link>
                  ))}
                </nav>

                <div className="mt-1 border-t border-rule pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      logout.mutate();
                    }}
                    disabled={logout.isPending}
                    className="w-full rounded px-3 py-2.5 text-left text-sm text-ink hover:bg-paper-sunk disabled:opacity-60"
                  >
                    {logout.isPending ? 'Signing out…':'Sign out'}
                  </button>
                </div>
              </>
            )}
          </Disclosure>
        </div>
      </header>

      <main className="flex-1 py-8">{children}</main>

      <footer className="mt-8">
        {/* Same band that opens the public footer, at the app's weight. */}
        <div aria-hidden className="range-band-rule h-1 w-full" />

        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 pt-5">
          {[...APP_SECONDARY_NAV, ...LEGAL_NAV].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-xs text-ink-faint underline-offset-4 hover:text-ink-muted hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <CareBoundary className="mt-5 pb-8" />
      </footer>
    </div>
  );
}
