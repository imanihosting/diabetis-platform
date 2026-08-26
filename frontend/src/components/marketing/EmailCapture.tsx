'use client';

import { useState, type FormEvent } from 'react';

type State = 'idle' | 'submitting' | 'done' | 'invalid' | 'failed';

/**
 * Email capture for readers who are not ready to create an account.
 *
 * One field, because asking a stranger for more before they have seen anything
 * is a poor trade. The success message is identical whether the address is new
 * or already present, so the form cannot be used to check who is on the list.
 */
export function EmailCapture() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      setState('invalid');
      return;
    }

    setState('submitting');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  }

  if (state === 'done') {
    return (
      <p
        role="status"
        className="flex items-baseline gap-2 text-lede text-[var(--ink-muted)]"
      >
        <span aria-hidden className="text-[var(--in-range-text)]">
          &#10003;
        </span>
        We have your address. Nothing else, and nothing until there is
        something worth sending.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-md">
      <label htmlFor="waitlist-email" className="block text-sm text-[var(--ink-muted)]">
        Or leave your email
      </label>

      <div className="mt-2 flex items-stretch gap-2">
        <input
          id="waitlist-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          placeholder="you@example.com"
          aria-invalid={state === 'invalid'}
          aria-describedby={state === 'invalid' || state === 'failed' ? 'waitlist-msg' : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === 'invalid' || state === 'failed') setState('idle');
          }}
          className="min-w-0 flex-1 border-b border-[var(--rule)] bg-transparent pb-2 text-lede text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--ink)]"
        />
        <button
          type="submit"
          disabled={state === 'submitting'}
          className="shrink-0 self-end border-b border-[var(--ink)] pb-2 text-lede font-medium text-[var(--ink)] transition-opacity disabled:opacity-50"
        >
          {state === 'submitting' ? 'Sending' : 'Send'}
        </button>
      </div>

      {(state === 'invalid' || state === 'failed') && (
        <p id="waitlist-msg" role="alert" className="mt-2 text-sm text-[var(--below-range-text)]">
          {state === 'invalid'
            ? 'That address does not look complete.'
            : 'That did not send. Try again in a moment.'}
        </p>
      )}
    </form>
  );
}
