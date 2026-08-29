'use client';

import { useState } from 'react';
import { useResendVerification } from '@/hooks/useEmailVerification';

/**
 * "Send it again", wherever that is offered.
 *
 * One component because the three places it appears — waiting for the first
 * link, an expired link, a link that was never valid — must behave identically.
 * In particular they must all say the same thing afterwards: the server
 * answers the same way whether or not the address has an account, and a page
 * that said "sent" for one and "no such account" for the other would undo that
 * on the client side.
 *
 * `email` is passed in when the app already knows it, which lets the signed-in
 * case skip the field entirely.
 */
export function ResendVerification({
  email: known,
  label = 'Send the link again',
}: {
  email?: string;
  label?: string;
}) {
  const [email, setEmail] = useState(known ?? '');
  const resend = useResendVerification();

  if (resend.isSuccess) {
    return (
      <p role="status" className="text-sm text-ink-muted">
        If that address has an account waiting to be verified, a new link is on
        its way. It can take a minute or two to arrive.
      </p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        resend.mutate(email);
      }}
    >
      {!known && (
        <div>
          <label htmlFor="resend-email" className="block text-sm text-ink-muted">
            Email
          </label>
          <input
            id="resend-email"
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-lede text-ink focus:border-ink"
          />
        </div>
      )}

      {resend.isError && (
        <p role="alert" className="mt-4 text-sm text-zone-belowText">
          We could not send it right now. Wait a minute and try again — nothing
          about your account has changed.
        </p>
      )}

      <button
        type="submit"
        disabled={resend.isPending}
        className="btn btn-primary mt-6 w-full sm:w-auto"
      >
        {resend.isPending ? 'Sending…' : label}
      </button>
    </form>
  );
}
