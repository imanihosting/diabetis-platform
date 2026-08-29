import Link from 'next/link';
import type { ReactNode } from 'react';
import { LEGAL_NAV } from '@/lib/navigation';
import { Wordmark } from '@/components/RangeMark';

/**
 * Chrome for the pages between "not signed in" and "using the product".
 *
 * Verification, resend, password reset. None of them belong in AppShell, whose
 * navigation offers Timeline, Log and Evidence to someone who cannot reach any
 * of them yet, and none of them are the sign-in form. They share the sign-in
 * page's shape instead: the mark, one column, the legal row underneath.
 *
 * Deliberately quiet. Somebody arrives here because something is incomplete or
 * has gone wrong, and the page's job is to say what to do next in as few words
 * as it can. No illustration, no reassurance about the product, nothing that
 * reads as marketing at the moment a person is trying to get into their
 * account.
 */
export function AccountPageShell({
  title,
  children,
  // The default is true for every page here except the waitlist confirmation,
  // whose reader has no account and would rightly wonder what account is being
  // talked about.
  footnote = 'Wellovue emails you about your account only. Nothing you record in the app is ever sent by email.',
}: {
  title: string;
  children: ReactNode;
  footnote?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-7 py-5 sm:px-8">
        <Wordmark />
        <Link
          href="/login"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Sign in
        </Link>
      </header>

      <main className="flex flex-1 items-start px-7 py-[clamp(2rem,6vw,4rem)] sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          <h1 className="text-fold font-semibold text-balance">{title}</h1>
          <div className="mt-6">{children}</div>
        </div>
      </main>

      <footer className="border-t border-rule py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-7 sm:flex-row sm:items-baseline sm:justify-between sm:px-8">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
            {LEGAL_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-xs text-ink-faint underline-offset-4 hover:text-ink-muted hover:underline"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="max-w-[58ch] text-xs leading-relaxed text-ink-faint">
            {footnote}
          </p>
        </div>
      </footer>
    </div>
  );
}
