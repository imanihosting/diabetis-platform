'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useLogin, useRegister } from '@/hooks/useAuth';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useLogin();
  const register = useRegister();
  const active = mode === 'login' ? login : register;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === 'login') login.mutate({ email, password });
    else register.mutate({ email, password });
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-sm">
        <h1 className="text-xl font-medium tracking-tight text-ink">
          {mode === 'login' ? 'Sign in' : 'Create an account'}
        </h1>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            hint={mode === 'register' ? 'At least 12 characters.' : undefined}
          />

          {active.isError && (
            <p role="alert" className="text-sm text-range-below">
              {active.error instanceof ApiError
                ? active.error.message
                : 'Something went wrong.'}
            </p>
          )}

          <button
            type="submit"
            disabled={active.isPending}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-surface disabled:opacity-60"
          >
            {active.isPending
              ? 'Working…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          className="mt-4 text-sm text-ink-faint underline underline-offset-4 hover:text-ink-muted"
        >
          {mode === 'login'
            ? 'Need an account? Create one'
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  hint,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
}) {
  const id = `field-${label.toLowerCase()}`;
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
        className="mt-1 w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      />
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
