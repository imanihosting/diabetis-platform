'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  profileNeedsSetup,
  type DiabetesType,
  type SafetyFlag,
} from '@wellovue/types';
import { AppShell } from '@/components/AppShell';
import { useCurrentUser } from '@/hooks/useAuth';
import { useDiabetesProfile, useSaveDiabetesProfile } from '@/hooks/useDiabetesProfile';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * The care profile: what kind of diabetes, and the context that changes how
 * the data should be read.
 *
 * One page for both the first answer and every later correction. A separate
 * onboarding screen would drift from the settings screen, and the question is
 * the same question either way — only the framing differs, which is what the
 * `welcome` parameter changes.
 *
 * This gates the product: nothing is interpreted until it is answered. That
 * makes it the one screen that cannot be the one people cannot use, so it is
 * built from a radio group and checkboxes with real labels rather than styled
 * divs, and every option is reachable and announced without a mouse.
 */

const TYPES = [
  {
    value: 'type_2',
    label: 'Type 2 diabetes',
    detail: 'The context Wellovue currently produces evidence for.',
  },
  {
    value: 'type_1',
    label: 'Type 1 diabetes',
    detail: 'Recorded, but not yet interpreted. The analysis here is built on a different model of the body.',
  },
  {
    value: 'gestational',
    label: 'Gestational diabetes',
    detail: 'Recorded. Being built as a clinician-supported workflow.',
  },
  {
    value: 'prediabetes',
    label: 'Prediabetes',
    detail: 'Lab, weight, fasting glucose and activity trends. Wellovue produces evidence for this.',
  },
  {
    value: 'other_specific',
    label: 'Another specific kind',
    detail: 'Monogenic, pancreatic, medication-induced, or something a clinician has classified.',
  },
  {
    value: 'unknown',
    label: 'I am not sure',
    detail: 'A real answer. Wellovue will keep your records and will not guess at what they mean.',
  },
] as const satisfies readonly { value: DiabetesType; label: string; detail: string }[];

/**
 * Fails the build if a diabetes type is added to the contract and not offered
 * here.
 *
 * Without it, a new type would be silently unreachable: the schema would accept
 * it, the engine would gate on it, and the only screen that can set it would
 * never show it. A comment asking the next person to remember is not a
 * guarantee; this is.
 */
type UnofferedType = Exclude<DiabetesType, (typeof TYPES)[number]['value']>;
const _everyTypeIsOffered: UnofferedType extends never ? true : UnofferedType = true;
void _everyTypeIsOffered;

/**
 * The flags worth asking a person about directly.
 *
 * Each one changes how the data must be read, which is why it is a question
 * rather than something inferred from medication names: names vary, imports
 * are incomplete, and being wrong about insulin is not a cosmetic error.
 */
const FLAGS: readonly { value: SafetyFlag; label: string; detail: string }[] = [
  {
    value: 'insulin_therapy',
    label: 'I take insulin',
    detail: 'Changes the safety boundaries around anything Wellovue suggests.',
  },
  {
    value: 'pump_or_automated_insulin_delivery',
    label: 'I use a pump or automated insulin delivery',
    detail: 'The system is making decisions too, so patterns cannot be read as if it were not.',
  },
  {
    value: 'pregnancy',
    label: 'I am pregnant',
    detail: 'Changes what these numbers mean, and who should be involved in reading them.',
  },
  {
    value: 'hypoglycemia_unawareness',
    label: 'I do not always feel my hypos coming on',
    detail: '',
  },
  {
    value: 'history_of_severe_hypoglycemia',
    label: 'I have had a severe hypo before',
    detail: 'One needing someone else’s help.',
  },
];

const OFFERED_FLAGS = FLAGS.map((f) => f.value);

export default function ProfilePage() {
  return (
    <Suspense fallback={null}>
      <ProfileView />
    </Suspense>
  );
}

function ProfileView() {
  const params = useSearchParams();
  const router = useRouter();
  const user = useCurrentUser();
  const profile = useDiabetesProfile();
  const save = useSaveDiabetesProfile();

  const welcome = params.get('welcome') === '1';

  const [diabetesType, setDiabetesType] = useState<DiabetesType | null>(null);
  const [flags, setFlags] = useState<SafetyFlag[]>([]);

  // Seeded from the server once, then left alone: re-seeding on every render
  // would fight the person typing.
  const loaded = profile.data;
  useEffect(() => {
    if (!loaded) return;
    setDiabetesType(
      profileNeedsSetup(loaded.profile) ? null : loaded.profile.diabetesType,
    );
    setFlags(loaded.activeFlags);
  }, [loaded]);

  if (user.isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-faint">Loading…</p>
      </AppShell>
    );
  }

  if (user.isError || !user.data) {
    return (
      <AppShell>
        <div className="surface-sunk px-6 py-12 text-center">
          <p className="text-ink">You are not signed in.</p>
          <a
            href="/login"
            className="mt-3 inline-block text-sm text-ink underline underline-offset-4"
          >
            Sign in to set up your profile
          </a>
        </div>
      </AppShell>
    );
  }

  const toggleFlag = (flag: SafetyFlag) =>
    setFlags((current) =>
      current.includes(flag) ? current.filter((f) => f !== flag) : [...current, flag],
    );

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!diabetesType) return;
    save.mutate(
      { diabetesType, flags, offeredFlags: OFFERED_FLAGS },
      { onSuccess: () => welcome && router.push('/evidence') },
    );
  }

  return (
    <AppShell>
      <h1 className="text-xl font-medium tracking-tight text-ink">
        {welcome ? 'Before Wellovue reads anything' : 'Care profile'}
      </h1>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted">
        {welcome
          ? 'Wellovue works out what is true for one person’s body, so it has to know whose body it is reading. It will not guess: until this is answered, your data is recorded and nothing is interpreted.'
          : 'What kind of diabetes you have, and the context that changes how your data should be read. You can change this at any time.'}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 max-w-xl">
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            What kind of diabetes do you have?
          </legend>
          <p className="mt-1 text-sm text-ink-faint">
            As it was diagnosed. Not a test.
          </p>

          <div className="mt-4 space-y-2">
            {TYPES.map((option) => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer gap-3 border p-4 transition-colors',
                  diabetesType === option.value
                    ? 'border-ink bg-paper-raised'
                    : 'border-rule hover:bg-paper-sunk',
                )}
              >
                <input
                  type="radio"
                  name="diabetesType"
                  value={option.value}
                  checked={diabetesType === option.value}
                  onChange={() => setDiabetesType(option.value)}
                  // The explanation is a description, not part of the name.
                  // Nested inside the label it would be concatenated onto it,
                  // and a screen reader would announce "Type 2 diabetesThe
                  // context Wellovue currently produces evidence for" as one
                  // run-on string for every option in the list.
                  aria-describedby={`type-detail-${option.value}`}
                  className="mt-1 accent-[var(--ink)]"
                />
                <span>
                  <span className="block text-sm text-ink">{option.label}</span>
                  <span
                    id={`type-detail-${option.value}`}
                    className="mt-0.5 block text-sm leading-relaxed text-ink-faint"
                  >
                    {option.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-10">
          <legend className="text-sm font-medium text-ink">
            Does any of this apply to you?
          </legend>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-faint">
            Each one changes how your data has to be read. Leaving a box unticked
            is recorded as a no, not as a blank.
          </p>

          <div className="mt-4 space-y-2">
            {FLAGS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer gap-3 border p-4 transition-colors',
                  flags.includes(option.value)
                    ? 'border-ink bg-paper-raised'
                    : 'border-rule hover:bg-paper-sunk',
                )}
              >
                <input
                  type="checkbox"
                  checked={flags.includes(option.value)}
                  onChange={() => toggleFlag(option.value)}
                  aria-describedby={
                    option.detail ? `flag-detail-${option.value}` : undefined
                  }
                  className="mt-1 accent-[var(--ink)]"
                />
                <span>
                  <span className="block text-sm text-ink">{option.label}</span>
                  {option.detail && (
                    <span
                      id={`flag-detail-${option.value}`}
                      className="mt-0.5 block text-sm leading-relaxed text-ink-faint"
                    >
                      {option.detail}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {save.isError && (
          <p role="alert" className="mt-6 text-sm text-zone-belowText">
            {save.error instanceof ApiError
              ? save.error.message
              : 'That could not be saved. Try again in a moment.'}
          </p>
        )}

        {save.isSuccess && !welcome && (
          <p role="status" className="mt-6 text-sm text-ink-muted">
            Saved.
          </p>
        )}

        <div className="mt-8 flex flex-wrap items-center gap-6">
          <button
            type="submit"
            disabled={!diabetesType || save.isPending}
            className="btn btn-primary text-sm"
          >
            {save.isPending ? 'Saving…' : welcome ? 'Save and continue' : 'Save'}
          </button>

          {welcome && (
            // Skippable on purpose. Someone who does not want to answer yet is
            // not required to, and the evidence screen says plainly what that
            // costs and how to change it. A gate with no way past it is how
            // people abandon an account rather than answer a question.
            <a
              href="/timeline"
              className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              Skip for now
            </a>
          )}
        </div>
      </form>

      <p className="measure mt-10 max-w-prose text-xs leading-relaxed text-ink-faint">
        {profile.data
          ? `Recorded care mode: ${profile.data.capabilities.careMode} · safety tier: ${profile.data.capabilities.safetyTier}`
          : ' '}
      </p>
    </AppShell>
  );
}
