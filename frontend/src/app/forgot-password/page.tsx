'use client';

import { useState } from 'react';
import { AccountPageShell } from '@/components/AccountPageShell';
import { useRequestPasswordReset } from '@/hooks/useEmailVerification';

/**
 * Asks for a reset link.
 *
 * The confirmation is deliberately non-committal — "if that address has an
 * account" — because the server answers identically whether or not it does,
 * and a page that said "we have sent you an email" would leak on the client
 * side what the API refuses to leak on the server side.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const request = useRequestPasswordReset();

  if (request.isSuccess) {
    return (
      <AccountPageShell title="Check your email">
        <p role="status" className="text-lede text-ink-muted">
          If that address has a Wellovue account, a reset link is on its way. It
          works for one hour and can be used once.
        </p>
      </AccountPageShell>
    );
  }

  return (
    <AccountPageShell title="Reset your password">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          request.mutate(email);
        }}
      >
        <label htmlFor="reset-email" className="block text-sm text-ink-muted">
          Email
        </label>
        <input
          id="reset-email"
          type="email"
          required
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-lede text-ink focus:border-ink"
        />

        {request.isError && (
          <p role="alert" className="mt-5 text-sm text-zone-belowText">
            We could not send it right now. Wait a minute and try again.
          </p>
        )}

        <button
          type="submit"
          disabled={request.isPending}
          className="btn btn-primary mt-8 w-full sm:w-auto"
        >
          {request.isPending ? 'Sending…' : 'Send a reset link'}
        </button>
      </form>
    </AccountPageShell>
  );
}
