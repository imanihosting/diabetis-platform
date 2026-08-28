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
    // Not "being built": nobody is building it. It waits on clinical review
    // that has not started, and "being built" reads as "coming soon" to
    // somebody deciding whether to wait for it.
    detail:
      'Recorded, but not yet interpreted. Pregnancy changes what these numbers mean, and that needs clinical review before Wellovue reads them.',
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
  // Seeded from the browser, not assumed silently: the person is shown what it
  // is and can change it. A wrong timezone does not make a finding uncertain,
  // it makes it about the wrong hours, so it has to be visible rather than
  // inferred behind the scenes.
  const [timezone, setTimezone] = useState<string>(browserTimezone);

  // Seeded from the server once, then left alone: re-seeding on every render
  // would fight the person typing.
  const loaded = profile.data;
  useEffect(() => {
    if (!loaded) return;
    setDiabetesType(
      profileNeedsSetup(loaded.profile) ? null : loaded.profile.diabetesType,
    );
    setFlags(loaded.activeFlags);
    // Only when the account already carries something other than the default.
    // A stored 'UTC' is what every account starts as, so preferring the
    // browser there corrects the common case instead of preserving it.
    if (loaded.timezone && loaded.timezone !== 'UTC') setTimezone(loaded.timezone);
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
      { diabetesType, timezone, flags, offeredFlags: OFFERED_FLAGS },
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

        <section className="mt-10 border-t border-rule pt-6">
          <h2 className="text-sm font-medium text-ink">Your time zone</h2>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
            Wellovue reads some findings by the hour: what counts as morning
            glucose, and what counts as a late meal. Those have to be your
            hours. If this is wrong, those findings are about the wrong part of
            your day.
          </p>

          <label htmlFor="timezone" className="mt-4 block text-sm text-ink-muted">
            Time zone
          </label>
          <select
            id="timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="mt-2 w-full max-w-sm border-b border-rule bg-transparent pb-2 text-base text-ink focus:border-ink"
          >
            {timezoneOptions(timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </section>

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

/**
 * What the browser believes this device's zone is.
 *
 * A starting point rather than a decision. It is right for most people most of
 * the time, and it is wrong on a shared machine or a laptop carried across a
 * border — so it seeds a control the person can see and change, and is never
 * saved without them having looked at it.
 */
const browserTimezone: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

/**
 * Every zone this browser knows, with the current one guaranteed present.
 *
 * `supportedValuesOf` is missing in older browsers, and a select that silently
 * dropped somebody's saved zone would reset it to whatever sorted first — so
 * the fallback is a short list that still contains what is in force.
 */
function timezoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC', browserTimezone];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}
