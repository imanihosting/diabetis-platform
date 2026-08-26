'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCurrentUser, useLogin, useRegister } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';
import { LEGAL_NAV } from '@/lib/navigation';

/**
 * Sign in and account creation.
 *
 * Deliberately not inside AppShell: that shell carries Timeline, Log, Evidence
 * and a sign-out control, none of which mean anything to someone who is not
 * signed in yet. This page has its own chrome, in the same visual language as
 * the rest of the site.
 */
export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const router = useRouter();
  const existing = useCurrentUser();

  // Arriving here with a live session means the visitor was looking for their
  // account, not for a form. Send them on rather than asking them to prove
  // again what the cookie already establishes.
  useEffect(() => {
    if (existing.data) router.replace('/timeline');
  }, [existing.data, router]);

  const login = useLogin();
  const register = useRegister();
  const active = mode === 'login' ? login : register;
  const creating = mode === 'register';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (creating) register.mutate({ email, password });
    else login.mutate({ email, password });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-7 py-5 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
          Wellovue
        </Link>
        <Link
          href="/how-it-works"
          className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
        >
          How this works
        </Link>
      </header>

      <main className="flex flex-1 items-center px-7 py-[clamp(2rem,6vw,4rem)] sm:px-6">
        <div className="mx-auto grid w-full max-w-5xl gap-x-20 gap-y-14 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <h1 className="max-w-[16ch] text-fold font-semibold text-balance">
              {creating ? 'Start with the data you already have.' : 'Welcome back.'}
            </h1>

            <p className="mt-5 max-w-[46ch] text-lede text-ink-muted">
              {creating
                ? 'A CSV from your meter or CGM is enough to begin. You can add meals and medication as you go.'
                : 'Your timeline, your findings, and everything you have tested so far.'}
            </p>

            {creating && (
              <ul className="mt-8 space-y-3 border-t border-rule pt-6">
                {[
                  'Your data is never sold, and never used for advertising',
                  'Every access is recorded in a trail you can read',
                  'Export or delete everything, whenever you want',
                ].map((line) => (
                  <li key={line} className="flex gap-3 text-sm leading-relaxed text-ink-muted">
                    <span aria-hidden className="text-zone-inText">
                      &#10003;
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lg:col-span-6 lg:pt-2">
            <form onSubmit={handleSubmit} className="max-w-md" noValidate>
              <Field
                id="field-email"
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
              />

              <div className="mt-6">
                <Field
                  id="field-password"
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  hint={creating ? 'At least 12 characters.' : undefined}
                />
              </div>

              {active.isError && (
                <p role="alert" className="mt-5 text-sm text-zone-belowText">
                  {active.error instanceof ApiError
                    ? active.error.message
                    : 'Something went wrong. Try again in a moment.'}
                </p>
              )}

              <button
                type="submit"
                disabled={active.isPending}
                className="mt-8 w-full bg-ink px-7 py-3.5 text-lede font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-60 sm:w-auto"
              >
                {active.isPending
                  ? 'Working…'
                  : creating
                    ? 'Create account'
                    : 'Sign in'}
              </button>

              <p className="mt-6 text-sm text-ink-muted">
                {creating ? 'Already have an account?' : 'New here?'}{' '}
                <button
                  type="button"
                  onClick={() => setMode(creating ? 'login' : 'register')}
                  className="text-ink underline underline-offset-4"
                >
                  {creating ? 'Sign in' : 'Create one'}
                </button>
              </p>
            </form>
          </div>
        </div>
      </main>

      <footer className="border-t border-rule py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-7 sm:flex-row sm:items-baseline sm:justify-between sm:px-6">
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
            Not a medical device. Always speak to your clinician before changing
            anything about your treatment.
          </p>
        </div>
      </footer>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-lede text-ink focus:border-ink"
      />
      {hint && <p className="mt-2 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
