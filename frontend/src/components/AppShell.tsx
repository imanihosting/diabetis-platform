'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Disclosure } from '@/components/Disclosure';
import { APP_NAV, LEGAL_NAV, MARKETING_NAV, isCurrent } from '@/lib/navigation';
import { useLogout } from '@/hooks/useAuth';

/**
 * Chrome for the signed-in app.
 *
 * The primary row stays Timeline, Log and Evidence: that is the daily work, and
 * putting About or Contact beside them would make six equal-looking links where
 * three of them are read once. The public pages are reachable from a disclosure
 * and again from the footer, which is where people look for them anyway.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const logout = useLogout();

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between gap-4 border-b border-rule py-5">
        <Link href="/timeline" className="text-sm font-medium tracking-tight text-ink">
          Wellovue
        </Link>

        <div className="flex items-center gap-6">
          <nav className="flex gap-6" aria-label="Main">
            {APP_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                className={cn(
                  'text-sm transition-colors',
                  isCurrent(pathname, item.href)
                    ? 'text-ink'
                    : 'text-ink-faint hover:text-ink-muted',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Disclosure
            label="More"
            triggerClassName="text-sm text-ink-faint transition-colors hover:text-ink-muted"
            panelClassName="w-[min(20rem,calc(100vw-3rem))]  border border-rule bg-paper-raised p-2 shadow-[0_18px_40px_-28px_rgb(0_0_0/0.45)]"
          >
            {(close) => (
              <>
                <nav aria-label="More" className="flex flex-col">
                  {MARKETING_NAV.map((item) => (
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

      <footer className="border-t border-rule py-5">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          {[...MARKETING_NAV, ...LEGAL_NAV].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-xs text-ink-faint underline-offset-4 hover:text-ink-muted hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="mt-4 text-xs leading-relaxed text-ink-faint">
          This platform helps you understand patterns in your own data and
          prepare for conversations with your clinician. It does not diagnose
          conditions, adjust medication, or provide emergency advice.
        </p>
      </footer>
    </div>
  );
}
