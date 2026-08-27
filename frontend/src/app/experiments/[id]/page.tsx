'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  expectationFrom,
  experimentDecision,
  type Experiment,
  type ExperimentDetail,
  type Prediction,
  type PredictionOutcome,
} from '@wellovue/types';
import { AppShell } from '@/components/AppShell';
import { ExperimentState } from '@/components/ExperimentState';
import { useCompleteExperiment, useExperiment, useStartExperiment } from '@/hooks/useExperiment';
import { useCurrentUser } from '@/hooks/useAuth';
import { useDiabetesProfile } from '@/hooks/useDiabetesProfile';
import { ApiError } from '@/lib/api';

/**
 * One experiment, from proposed to settled.
 *
 * This is the first place somebody sees whether the platform was right about
 * them, and the design follows from that single fact.
 *
 * The predicted and observed values sit in the same block, at the same size,
 * in the same ink. Neither is coloured. Colour in this product means one of
 * two things — where a glucose value sits relative to target, or how far a
 * finding can be trusted — and a green number for "we were right" would be a
 * third meaning invented to flatter the platform. The difference between them
 * is stated in words underneath, which is the part a person can actually use.
 *
 * Starting is here rather than on the list for the same reason: it is the
 * first irreversible thing anybody does in this product, and it should arrive
 * on the screen that shows what follows from it rather than as a button in a
 * row.
 */
export default function ExperimentPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const user = useCurrentUser();
  const detail = useExperiment(id);

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
        <div className="border border-rule px-6 py-10 text-center">
          <p className="text-ink">You are not signed in.</p>
          <Link
            href="/login"
            className="mt-3 inline-block text-sm text-ink underline underline-offset-4"
          >
            Sign in to see this experiment
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link
        href="/experiments"
        className="text-sm text-ink-faint underline underline-offset-4 hover:text-ink-muted"
      >
        All experiments
      </Link>

      {detail.isPending && (
        <p className="mt-8 text-sm text-ink-faint" role="status">
          Loading…
        </p>
      )}

      {detail.isError && (
        <p className="mt-8 text-sm text-zone-belowText" role="alert">
          {detail.error instanceof ApiError && detail.error.status === 404
            ? 'No such experiment, or it belongs to somebody else.'
            : 'That could not be loaded. Try again in a moment.'}
        </p>
      )}

      {detail.data && <Detail id={id} detail={detail.data} />}
    </AppShell>
  );
}

function Detail({ id, detail }: { id: string; detail: ExperimentDetail }) {
  const { experiment, prediction, outcome } = detail;

  return (
    <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h1 className="max-w-md text-xl font-medium tracking-tight text-ink">
          {experiment.title}
        </h1>
        <ExperimentState experiment={experiment} />
      </div>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
        {experiment.question}
      </p>

      <Protocol experiment={experiment} />

      {prediction && <Expected prediction={prediction} />}

      {outcome && prediction && <Comparison prediction={prediction} outcome={outcome} />}

      {!outcome && <Action id={id} experiment={experiment} prediction={prediction} />}
    </>
  );
}

/**
 * What the person is actually being asked to do, in the engine's own words.
 *
 * Rendered from whatever the protocol holds rather than from a fixed set of
 * keys: the protocols come from the shared proposal catalogue and will gain
 * fields, and a screen that silently drops the ones it was not written for is
 * a screen that tells somebody to run half an experiment.
 */
function Protocol({ experiment }: { experiment: Experiment }) {
  const entries = Object.entries(experiment.protocol).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );
  if (entries.length === 0) return null;

  return (
    <section className="mt-8 border-t border-rule pt-6">
      <h2 className="text-xs uppercase tracking-wide text-ink-faint">The protocol</h2>
      <dl className="mt-3 space-y-3">
        {entries.map(([key, value]) => (
          <div key={key} className="sm:flex sm:gap-6">
            <dt className="text-sm text-ink-faint sm:w-32 sm:shrink-0">{humanise(key)}</dt>
            <dd className="max-w-prose text-sm leading-relaxed text-ink">
              {Array.isArray(value) ? value.map(humanise).join(', ') : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The expectation, exactly as it was written before the trial began.
 *
 * The engine version and the timestamp are not decoration. They are what makes
 * this a record rather than a claim: they say which build committed to this
 * number, and when — before the answer existed.
 */
function Expected({ prediction }: { prediction: Prediction }) {
  const expectation = expectationFrom(prediction);

  return (
    <section className="mt-8 border-t border-rule pt-6">
      <h2 className="text-xs uppercase tracking-wide text-ink-faint">
        Recorded before it started
      </h2>

      {expectation ? (
        <>
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink">
            {expectation.statement}
          </p>
          <p className="mt-4 text-reading-sm font-medium text-ink">
            <span className="measure">{signed(expectation.expectedEffect)}</span>
            {expectation.unit && (
              <span className="ml-2 font-sans text-xs font-normal text-ink-faint">
                {expectation.unit}
              </span>
            )}
          </p>
        </>
      ) : (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
          This prediction was written in a form this screen does not recognise,
          so it is not shown rather than guessed at.
        </p>
      )}

      <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-faint">
        Written {formatDate(prediction.madeAt)} by {prediction.modelVersion}
        {prediction.confidence !== null &&
          `, at ${Math.round(prediction.confidence * 100)}% confidence`}
        . It cannot be edited, by anybody, including us.
      </p>
    </section>
  );
}

/**
 * Predicted against observed.
 *
 * The two numbers, then the gap between them in words. A person reading this
 * is asking one question — was it right? — and the answer to that is the
 * difference, not either figure on its own.
 *
 * The closing sentence is not a hedge. One trial is one trial, and a product
 * that let a single close call read as proof would be making exactly the claim
 * it exists to avoid.
 */
function Comparison({
  prediction,
  outcome,
}: {
  prediction: Prediction;
  outcome: PredictionOutcome;
}) {
  const expectation = expectationFrom(prediction);
  const summary = outcome.errorSummary;
  const unit = expectation?.unit ?? null;

  return (
    <section className="mt-8 border border-rule bg-paper-raised p-5">
      <h2 className="text-xs uppercase tracking-wide text-ink-faint">
        What happened, against what was predicted
      </h2>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Figure label="Predicted" value={summary?.expectedEffect ?? null} unit={unit} />
        <Figure label="Observed" value={outcome.outcome.observedEffect} unit={unit} />
      </dl>

      <p className="mt-5 max-w-prose border-t border-rule pt-4 text-sm leading-relaxed text-ink">
        {verdict(summary?.error ?? null)}
      </p>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
        One experiment is one experiment. This is a single comparison, not a
        verdict on the platform or on you. What it is worth is what these look
        like after several.
      </p>

      {outcome.outcome.notes && (
        <p className="mt-5 border-t border-rule pt-4 text-sm leading-relaxed text-ink-muted">
          {outcome.outcome.notes}
        </p>
      )}

      <p className="mt-4 text-sm text-ink-faint">
        Measured {formatDate(outcome.observedAt)}.
      </p>
    </section>
  );
}

function Figure({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | null;
  unit: string | null;
}) {
  return (
    <div>
      <dt className="text-sm text-ink-faint">{label}</dt>
      {/* Deliberately the same ink as its neighbour. Colouring the observed
          value by how close it landed would invent a third meaning for colour
          in a product that has exactly two. */}
      <dd className="mt-1 text-reading-sm font-medium text-ink">
        <span className="measure">{value === null ? '—' : signed(value)}</span>
        {value !== null && unit && (
          <span className="ml-2 font-sans text-xs font-normal text-ink-faint">{unit}</span>
        )}
      </dd>
    </div>
  );
}

/**
 * What is left to do, if anything.
 *
 * Four states, and each says plainly whose move it is. A blocked experiment
 * gets no action and no apology: the product considered a real question and
 * declined it, and that is the answer.
 */
function Action({
  id,
  experiment,
  prediction,
}: {
  id: string;
  experiment: Experiment;
  prediction: Prediction | null;
}) {
  if (experiment.safetyStatus === 'blocked') {
    return (
      <Note>
        <Reason experiment={experiment} />
        {' '}Nothing about it is a matter of timing. This is a conversation for
        your clinician, not for an app that also draws charts about your
        glucose.
      </Note>
    );
  }

  if (experiment.safetyStatus === 'clinician_gated') {
    return (
      <Note>
        <Reason experiment={experiment} />
        {' '}Wellovue has no way to record that agreement yet, so it stays here,
        waiting, rather than pretending there is a queue somebody is working
        through.
      </Note>
    );
  }

  if (experiment.status === 'draft') return <Start id={id} />;

  if (experiment.status === 'active' && prediction) {
    return <RecordResult id={id} prediction={prediction} experiment={experiment} />;
  }

  return null;
}

function Start({ id }: { id: string }) {
  const start = useStartExperiment(id);

  return (
    <section className="mt-8 border-t border-rule pt-6">
      <h2 className="text-sm font-medium text-ink">Starting this</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        Wellovue will work out what it expects to happen from your data as it
        stands right now, and write that down before you begin. It cannot be
        edited afterwards, and neither can the result you record against it.
        That is the whole point, and it is also why this experiment cannot be
        deleted once it has started.
      </p>

      <button
        type="button"
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="mt-4 min-h-[2.75rem] bg-ink px-6 text-base font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-60"
      >
        {start.isPending ? 'Recording the prediction…' : 'Record the prediction and start'}
      </button>

      {start.isError && (
        <p role="alert" className="mt-3 max-w-prose text-sm text-zone-belowText">
          {start.error instanceof ApiError
            ? start.error.message
            : 'That could not be started. Try again in a moment.'}
        </p>
      )}
    </section>
  );
}

/**
 * The measurement, and the act of finishing.
 *
 * One form, because they are one thing. Recording a result without ending the
 * trial would leave it running with its answer already known, and the server
 * refuses to do one without the other anyway.
 */
function RecordResult({
  id,
  prediction,
  experiment,
}: {
  id: string;
  prediction: Prediction;
  experiment: Experiment;
}) {
  const complete = useCompleteExperiment(id);
  const expectation = expectationFrom(prediction);
  const [observedEffect, setObservedEffect] = useState('');
  const [observedAt, setObservedAt] = useState(todayLocal());
  const [notes, setNotes] = useState('');

  return (
    <section className="mt-8 border-t border-rule pt-6">
      <h2 className="text-sm font-medium text-ink">Record what happened</h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        Running since {formatDate(experiment.startedAt ?? experiment.createdAt)}. Enter
        the difference you measured, keeping the sign: a drop is negative. The
        field below names the unit. This is written once and cannot be changed,
        so that a disappointing result can never quietly become a better one.
      </p>

      <form
        className="mt-4 max-w-md space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          complete.mutate({
            observedEffect: Number(observedEffect),
            observedAt: new Date(observedAt),
            notes: notes.trim() || undefined,
          });
        }}
      >
        <Field
          label={`What you measured${expectation?.unit ? ` (${expectation.unit})` : ''}`}
          id="observedEffect"
        >
          <input
            id="observedEffect"
            type="number"
            step="0.01"
            required
            value={observedEffect}
            onChange={(e) => setObservedEffect(e.target.value)}
            className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-base text-ink focus:border-ink"
          />
        </Field>

        <Field label="When you measured it" id="observedAt">
          <input
            id="observedAt"
            type="date"
            required
            value={observedAt}
            onChange={(e) => setObservedAt(e.target.value)}
            className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-base text-ink focus:border-ink"
          />
        </Field>

        <Field label="Anything worth remembering about the week (optional)" id="notes">
          <textarea
            id="notes"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-base text-ink focus:border-ink"
          />
        </Field>

        {complete.isError && (
          <p role="alert" className="max-w-prose text-sm text-zone-belowText">
            {complete.error instanceof ApiError
              ? complete.error.message
              : 'That could not be saved. Try again in a moment.'}
          </p>
        )}

        <button
          type="submit"
          disabled={complete.isPending}
          className="min-h-[2.75rem] bg-ink px-6 text-base font-medium text-paper transition-opacity hover:opacity-85 disabled:opacity-60"
        >
          {complete.isPending ? 'Recording…' : 'Record it and finish'}
        </button>
      </form>
    </section>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The safety rule's own sentence, not a restatement of it.
 *
 * Run through `experimentDecision` from the shared contract — the same
 * function the API called when this was proposed — so the words a person reads
 * here cannot drift from the words that were used to refuse it. The same
 * reasoning as `findingStrength`: one function, both surfaces.
 *
 * The persisted status still governs what the screen offers. This only supplies
 * the explanation, and says nothing at all if the profile has not loaded or the
 * experiment predates templates being recorded.
 */
function Reason({ experiment }: { experiment: Experiment }) {
  const profile = useDiabetesProfile();
  if (!experiment.template || !profile.data) return null;

  const decision = experimentDecision(experiment.template, {
    careMode: profile.data.capabilities.careMode,
    safetyFlags: profile.data.activeFlags,
  });

  // A profile that has changed since the proposal can classify it differently
  // now. The record is what was decided then, so a disagreement is not shown as
  // if it were this experiment's reason.
  if (decision.status !== experiment.safetyStatus) return null;

  return <>{decision.reason}</>;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-rule pt-6">
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{children}</p>
    </section>
  );
}

/**
 * The gap, in words.
 *
 * Phrased as higher or lower than predicted, never as better or worse. For one
 * finding a negative number is an improvement and for another it is simply a
 * lower average, so a screen that called a miss "worse" would be right about
 * half of them — the same reasoning that keeps colour off these figures.
 *
 * "Higher" and "lower" also survive the sign convention changing. Describing
 * the effect as larger or smaller would silently invert the moment a detector
 * predicts a rise rather than a drop.
 */
function verdict(error: number | null): string {
  if (error === null) {
    return 'There is no expected value to compare this against, so it stands on its own.';
  }

  const size = Math.abs(error);

  // No unit in the sentence. The engine's `effectUnit` is a descriptive phrase
  // — "mmol/L difference in glucose rise" — which labels a figure well and
  // reads as nonsense mid-clause. Both figures directly above carry it, so the
  // reader has the unit without this sentence shortening it into something the
  // engine never said.
  if (size < 0.05) {
    return `What you measured matched what was predicted, to within ${size.toFixed(2)}.`;
  }

  return error > 0
    ? `What you measured came out ${size.toFixed(2)} higher than predicted.`
    : `What you measured came out ${size.toFixed(2)} lower than predicted.`;
}

/** Keeps the sign: "1.1" and "-1.1" are different answers. */
function signed(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Today, as a `date` input wants it, in the reader's own timezone. */
function todayLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
