'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AccountPageShell } from '@/components/AccountPageShell';
import { useCompletePasswordReset } from '@/hooks/useEmailVerification';

/**
 * Where a reset link lands.
 *
 * Setting a password here ends every session on the account, including this
 * browser's — the server revokes them and clears the cookie — so the page
 * offers a sign-in link rather than trying to continue. Somebody resetting a
 * password they believe was stolen should be told plainly that the other
 * sessions are gone; that is the part of the operation they actually wanted.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordView />
    </Suspense>
  );
}

function ResetPasswordView() {
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const complete = useCompletePasswordReset();

  if (!token) {
    return (
      <AccountPageShell title="That link is not complete">
        <p className="text-lede text-ink-muted">
          The address is missing the part that identifies it. Copy the whole
          link from the email, or ask for a new one.
        </p>
        <Link href="/forgot-password" className="btn btn-primary mt-8 inline-block">
          Ask for a new link
        </Link>
      </AccountPageShell>
    );
  }

  if (complete.data?.reset) {
    return (
      <AccountPageShell title="Your password is changed">
        <p className="text-lede text-ink-muted">
          Every signed-in session on your account was ended, so you will need to
          sign in again — here and anywhere else you were signed in.
        </p>
        <Link href="/login" className="btn btn-primary mt-8 inline-block">
          Sign in
        </Link>
      </AccountPageShell>
    );
  }

  const refused = complete.data && !complete.data.reset;

  return (
    <AccountPageShell title="Choose a new password">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          complete.mutate({ token, password });
        }}
      >
        <label htmlFor="new-password" className="block text-sm text-ink-muted">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          required
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-lede text-ink focus:border-ink"
        />
        <p className="mt-2 text-xs text-ink-faint">At least 12 characters.</p>

        {refused && (
          <p role="alert" className="mt-5 text-sm text-zone-belowText">
            {complete.data?.reason === 'expired'
              ? 'That link has expired. Reset links last one hour.'
              : 'That link is not valid. It may already have been used.'}{' '}
            <Link href="/forgot-password" className="text-ink underline underline-offset-4">
              Ask for a new one
            </Link>
            .
          </p>
        )}

        {complete.isError && (
          <p role="alert" className="mt-5 text-sm text-zone-belowText">
            We could not change it right now. Your password has not changed. Try
            again in a minute.
          </p>
        )}

        <button
          type="submit"
          disabled={complete.isPending}
          className="btn btn-primary mt-8 w-full sm:w-auto"
        >
          {complete.isPending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AccountPageShell>
  );
}
