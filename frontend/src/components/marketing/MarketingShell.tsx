'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Disclosure } from '@/components/Disclosure';
import { RangeMark, Wordmark } from '@/components/RangeMark';
import { CareBoundary } from '@/components/CareBoundary';
import { MENU_TRIGGER_CLASS, MenuTriggerContent } from '@/components/MenuButton';
import {
  CREATE_ACCOUNT_HREF,
  FOOTER_GROUPS,
  MARKETING_NAV,
  SIGN_IN_HREF,
  isCurrent,
} from '@/lib/navigation';
import { useSessionHint } from '@/hooks/useSessionHint';
import { cn } from '@/lib/cn';

/**
 * Header and footer for every public page.
 *
 * The chrome used to be scaffolding: a text wordmark, four links at one
 * weight, a hairline rule, and the safety boundary set in the smallest type on
 * the page. Nothing about it said which product this was.
 *
 * It says so now through the product's own drawing rather than through volume.
 * The mark is the target band with a trace settling into it; the current page
 * is marked with that band's geometry rendered in ink; the footer opens on a
 * thin band instead of a hairline. No new colour was introduced to do it, and
 * none of it is decoration a reader has to learn separately, because it is all
 * the same object the charts already teach.
 *
 * The nav sits inline from the medium breakpoint up and behind a disclosure
 * below it: four items plus an action will not fit on a 360px phone without
 * shrinking the type past the legibility floor the rest of the page holds to.
 */
export function MarketingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Someone already signed in needs a way back to their own timeline. Sending
  // them to a login form they do not need is how a public page becomes a dead
  // end for the people who use the product most.
  const signedIn = useSessionHint();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-8 px-7 py-7 sm:px-8">
        <Wordmark />

        <nav aria-label="Main" className="hidden items-center gap-9 md:flex">
          {MARKETING_NAV.map((item) => {
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
                    : 'nav-band nav-band-hover text-ink-muted hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            );
          })}

          {signedIn ? (
            <Link
              href="/timeline"
              className="btn btn-primary min-h-[2.6rem] px-5 text-sm"
            >
              Your timeline
            </Link>
          ) : (
            <div className="flex items-center gap-6">
              {/* Sign in stays a quiet link. Returning users know where it is
                  and go looking for it; the account that does not exist yet is
                  the one that needs an obvious door. */}
              <Link
                href={SIGN_IN_HREF}
                className="nav-band nav-band-hover text-sm text-ink-muted transition-colors hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                href={CREATE_ACCOUNT_HREF}
                className="btn btn-primary min-h-[2.6rem] px-5 text-sm"
              >
                Create account
              </Link>
            </div>
          )}
        </nav>

        <div className="md:hidden">
          <Disclosure
            label="Menu"
            renderTrigger={(open) => <MenuTriggerContent open={open} />}
            triggerClassName={MENU_TRIGGER_CLASS}
            panelClassName="w-[min(19rem,calc(100vw-3.5rem))] surface-raised p-2 shadow-[0_18px_40px_-28px_rgb(0_0_0/0.5)]"
          >
            {(close) => (
              <nav aria-label="Main" className="flex flex-col">
                {MARKETING_NAV.map((item) => {
                  const current = isCurrent(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={close}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'flex min-h-[2.75rem] items-center px-3 text-sm',
                        current
                          ? 'font-medium text-ink'
                          : 'text-ink-muted hover:bg-paper-sunk hover:text-ink',
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}

                <div className="mt-2 flex flex-col gap-2 border-t border-rule pt-3">
                  {signedIn ? (
                    <Link
                      href="/timeline"
                      onClick={close}
                      className="btn btn-primary w-full text-sm"
                    >
                      Your timeline
                    </Link>
                  ) : (
                    <>
                      <Link
                        href={CREATE_ACCOUNT_HREF}
                        onClick={close}
                        className="btn btn-primary w-full text-sm"
                      >
                        Create account
                      </Link>
                      <Link
                        href={SIGN_IN_HREF}
                        onClick={close}
                        className="flex min-h-[2.75rem] items-center justify-center px-3 text-sm text-ink-muted hover:bg-paper-sunk hover:text-ink"
                      >
                        Sign in
                      </Link>
                    </>
                  )}
                </div>
              </nav>
            )}
          </Disclosure>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <SiteFooter signedIn={signedIn} />
    </div>
  );
}

function SiteFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer className="mt-[clamp(3rem,7vw,6rem)]">
      {/* The target band as the page's ground line, replacing a hairline rule.
          The same object every chart above it is drawn on, so it reads as this
          product signing the page rather than as a decorative stripe. */}
      <div aria-hidden className="range-band-rule h-1.5 w-full" />

      <div className="mx-auto max-w-6xl px-7 py-[clamp(2.5rem,5vw,4rem)] sm:px-8">
        <div className="flex flex-col gap-x-16 gap-y-10 lg:flex-row lg:justify-between">
          <div className="max-w-[34ch]">
            <div className="flex items-center gap-2.5 text-[0.95rem] font-semibold tracking-tight text-ink">
              <RangeMark />
              Wellovue
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Personal metabolic evidence, from your own data.
            </p>

            {!signedIn && (
              <Link
                href={CREATE_ACCOUNT_HREF}
                className="btn btn-primary mt-6 min-h-[2.75rem] px-6 text-sm"
              >
                Create account
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-9 sm:grid-cols-4 lg:gap-x-14">
            {FOOTER_GROUPS.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.11em] text-ink-faint">
                  {group.title}
                </h2>
                <ul className="mt-4 space-y-3">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-sm text-ink-muted transition-colors hover:text-ink"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <CareBoundary className="mt-[clamp(2.5rem,5vw,3.5rem)]" />

        <p className="mt-8 text-xs text-ink-faint">
          &#169; {new Date().getFullYear()} Wellovue
        </p>
      </div>
    </footer>
  );
}
