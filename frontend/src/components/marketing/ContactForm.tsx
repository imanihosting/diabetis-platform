'use client';

import { useState, type FormEvent } from 'react';
import type { ContactTopic } from '@wellovue/types';

type State = 'idle' | 'submitting' | 'done' | 'failed';

const TOPICS: { value: ContactTopic; label: string }[] = [
  { value: 'general', label: 'A general question' },
  { value: 'account', label: 'My account or sign-in' },
  { value: 'data', label: 'My data, an import, or erasure' },
  { value: 'clinician', label: 'I am a clinician' },
  { value: 'press', label: 'Press or partnership' },
];

const MAX = 5000;

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<ContactTopic>('general');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<State>('idle');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      next.email = 'We need a working address to reply to.';
    }
    if (message.trim().length < 10) {
      next.message = 'A sentence or two, so we know what you need.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    setState('submitting');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name || undefined, email, topic, message }),
      });
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  }

  if (state === 'done') {
    return (
      <div role="status" className="surface-raised p-8">
        <p className="flex items-baseline gap-2.5 text-lede text-[var(--ink)]">
          <span aria-hidden className="text-[var(--in-range-text)]">
            &#10003;
          </span>
          That reached us.
        </p>
        <p className="mt-3 max-w-[52ch] leading-relaxed text-[var(--ink-muted)]">
          We read everything and reply to {email}. If it is urgent and clinical,
          please do not wait on us: contact your clinician or your local
          emergency service.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="max-w-2xl">
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          id="contact-name"
          label="Your name"
          optional
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        <Field
          id="contact-email"
          label="Email"
          type="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (errors.email) setErrors((e) => ({ ...e, email: '' }));
          }}
          autoComplete="email"
          error={errors.email}
        />
      </div>

      <div className="mt-6">
        <label htmlFor="contact-topic" className="block text-sm text-[var(--ink-muted)]">
          What is this about?
        </label>
        <select
          id="contact-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value as ContactTopic)}
          className="mt-2 w-full border-b border-[var(--rule)] bg-transparent pb-2 text-lede text-[var(--ink)] focus:border-[var(--ink)] sm:w-auto sm:min-w-[22rem]"
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        <label htmlFor="contact-message" className="block text-sm text-[var(--ink-muted)]">
          Message
        </label>
        <textarea
          id="contact-message"
          rows={6}
          value={message}
          maxLength={MAX}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? 'contact-message-error' : 'contact-message-hint'}
          onChange={(e) => {
            setMessage(e.target.value);
            if (errors.message) setErrors((err) => ({ ...err, message: '' }));
          }}
          className="mt-2 w-full resize-y surface-raised p-4 text-[1.0625rem] leading-relaxed text-[var(--ink)] focus:border-[var(--ink)]"
        />

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p id="contact-message-hint" className="max-w-[58ch] text-xs leading-relaxed text-[var(--ink-faint)]">
            Please leave out medical details. This is an ordinary support inbox,
            not part of your health record, and we would rather not hold
            something you did not mean to send.
          </p>
          <p className="measure shrink-0 text-xs text-[var(--ink-faint)]">
            {message.length}/{MAX}
          </p>
        </div>

        {errors.message && (
          <p id="contact-message-error" role="alert" className="mt-2 text-sm text-[var(--below-range-text)]">
            {errors.message}
          </p>
        )}
      </div>

      {state === 'failed' && (
        <p role="alert" className="mt-6 text-sm text-[var(--below-range-text)]">
          That did not send. Try again in a moment.
        </p>
      )}

      <button
        type="submit"
        disabled={state === 'submitting'}
        className="mt-8 bg-[var(--ink)] px-7 py-3.5 text-lede font-medium text-[var(--paper)] transition-opacity hover:opacity-85 disabled:opacity-50"
      >
        {state === 'submitting' ? 'Sending' : 'Send message'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  optional,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  optional?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-[var(--ink-muted)]">
        {label}
        {optional && (
          <span className="text-[var(--ink-faint)]"> (optional)</span>
        )}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full border-b border-[var(--rule)] bg-transparent pb-2 text-lede text-[var(--ink)] focus:border-[var(--ink)]"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-[var(--below-range-text)]">
          {error}
        </p>
      )}
    </div>
  );
}
