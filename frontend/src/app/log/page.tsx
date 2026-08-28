'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { KNOWN_LAB_UNITS, type KnownLabTest } from '@wellovue/types';
import { api, ApiError } from '@/lib/api';

type Tab = 'glucose' | 'meal' | 'activity' | 'labs';

export default function LogPage() {
  const [tab, setTab] = useState<Tab>('glucose');

  return (
    <AppShell>
      <h1 className="text-xl font-medium tracking-tight text-ink">Log</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Everything you add here appears on your timeline with its source.
      </p>

      <div className="mt-6 flex gap-6 border-b border-rule" role="tablist">
        {(['glucose','meal','activity','labs'] as Tab[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            onClick={() => setTab(option)}
            className={
              tab === option
                ? 'border-b-2 border-ink pb-2 text-sm capitalize text-ink'
                : 'border-b-2 border-transparent pb-2 text-sm capitalize text-ink-faint hover:text-ink-muted'
            }
          >
            {option}
          </button>
        ))}
      </div>

      <div className="mt-6 max-w-md">
        {tab === 'glucose' && <GlucoseForm />}
        {tab === 'meal' && <MealForm />}
        {tab === 'activity' && <ActivityForm />}
        {tab === 'labs' && <LabForm />}
      </div>
    </AppShell>
  );
}

/** Local datetime string for a datetime-local input, defaulting to now. */
function nowLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function GlucoseForm() {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'mmol/L' | 'mg/dL'>('mmol/L');
  const [measuredAt, setMeasuredAt] = useState(nowLocal());

  const mutation = useMutation({
    mutationFn: () =>
      api.glucose.create({
        measuredAt: new Date(measuredAt).toISOString(),
        value: Number(value),
        unit,
        source: 'manual',
      }),
    onSuccess: () => {
      setValue('');
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
      queryClient.invalidateQueries({ queryKey: ['glucoseSummary'] });
    },
  });

  return (
    <Form onSubmit={() => mutation.mutate()} mutation={mutation} label="Add reading">
      <div className="flex gap-3">
        <Input
          label="Reading"
          type="number"
          step="0.1"
          value={value}
          onChange={setValue}
          required
        />
        <div>
          <label htmlFor="unit" className="block text-sm text-ink-muted">
            Unit
          </label>
          <select
            id="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as 'mmol/L' | 'mg/dL')}
            className="mt-2 border-b border-rule bg-transparent pb-2 text-base text-ink focus:border-ink"
          >
            <option value="mmol/L">mmol/L</option>
            <option value="mg/dL">mg/dL</option>
          </select>
        </div>
      </div>
      <Input
        label="When"
        type="datetime-local"
        value={measuredAt}
        onChange={setMeasuredAt}
        required
      />
      <CsvImport />
    </Form>
  );
}

function CsvImport() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (file: File) => api.glucose.importCsv(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
      queryClient.invalidateQueries({ queryKey: ['glucoseSummary'] });
    },
  });

  return (
    <div className="surface-sunk px-4 py-3">
      <label htmlFor="csv" className="block text-sm text-ink-muted">
        Or import a CGM / meter export
      </label>
      <input
        id="csv"
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) mutation.mutate(file);
        }}
        className="mt-2 block w-full text-xs text-ink-faint file:mr-3 file:rounded file:border file:border-rule file:bg-paper-raised file:px-3 file:py-1.5 file:text-xs file:text-ink"
      />
      {mutation.isPending && (
        <p className="mt-2 text-xs text-ink-faint">Importing…</p>
      )}
      {mutation.isSuccess && (
        <p className="mt-2 text-xs text-evidence-strong">
          Imported {mutation.data.imported} readings
          {mutation.data.duplicates > 0 &&
            `, skipped ${mutation.data.duplicates} already present`}
          .
        </p>
      )}
      {mutation.isError && (
        <p className="mt-2 text-xs text-zone-belowText">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Import failed.'}
        </p>
      )}
    </div>
  );
}

function MealForm() {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState('');
  const [mealType, setMealType] = useState('lunch');
  const [startedAt, setStartedAt] = useState(nowLocal());
  const [carbs, setCarbs] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.meals.create({
        startedAt: new Date(startedAt).toISOString(),
        mealType,
        description,
        source: 'manual',
        items: carbs
          ? [
              {
                itemName: description || 'Meal',
                estimatedCarbsG: Number(carbs),
                // Hand-estimated macros are guesses, and are stored as such.
                confidence: 0.5,
              },
            ]
          : [],
      }),
    onSuccess: () => {
      setDescription('');
      setCarbs('');
      queryClient.invalidateQueries({ queryKey: ['timeline'] });
    },
  });

  return (
    <Form onSubmit={() => mutation.mutate()} mutation={mutation} label="Log meal">
      <Input label="What did you eat?" value={description} onChange={setDescription} required />
      <div className="flex gap-3">
        <div className="flex-1">
          <label htmlFor="mealType" className="block text-sm text-ink-muted">
            Meal
          </label>
          <select
            id="mealType"
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
            className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-base text-ink focus:border-ink"
          >
            {['breakfast','lunch','dinner','snack','other'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="Carbs (g, optional)"
          type="number"
          value={carbs}
          onChange={setCarbs}
        />
      </div>
      <Input label="When" type="datetime-local" value={startedAt} onChange={setStartedAt} required />
    </Form>
  );
}

function ActivityForm() {
  const queryClient = useQueryClient();
  const [minutes, setMinutes] = useState('12');
  const [occurredAt, setOccurredAt] = useState(nowLocal());

  const mutation = useMutation({
    mutationFn: () =>
      api.timeline.addEvent({
        occurredAt: new Date(occurredAt).toISOString(),
        eventType: 'exercise_started',
        source: 'manual',
        payload: { kind: 'walk', minutes: Number(minutes) },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timeline'] }),
  });

  return (
    <Form onSubmit={() => mutation.mutate()} mutation={mutation} label="Log activity">
      <Input label="Minutes walked" type="number" value={minutes} onChange={setMinutes} required />
      <Input label="When" type="datetime-local" value={occurredAt} onChange={setOccurredAt} required />
    </Form>
  );
}

/**
 * HbA1c, fasting glucose, weight and BMI.
 *
 * These four first because they are what the prediabetes findings actually
 * read. A detector that suggests logging an HbA1c while the product offers no
 * way to record one is worse than a detector that says nothing: it asks
 * somebody to do something and then does not let them.
 *
 * The unit is prefilled from the contract and stays editable. A printout can
 * carry anything, and rejecting an unfamiliar unit would lose the reading —
 * so the value is stored exactly as entered, with whatever unit came with it.
 */
const LAB_TESTS: { value: KnownLabTest; label: string }[] = [
  { value: 'hba1c', label: 'HbA1c' },
  { value: 'fasting_glucose', label: 'Fasting glucose' },
  { value: 'weight', label: 'Weight' },
  { value: 'bmi', label: 'BMI' },
];

function LabForm() {
  const queryClient = useQueryClient();
  const [testName, setTestName] = useState<KnownLabTest>('hba1c');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(KNOWN_LAB_UNITS.hba1c ?? '');
  const [collectedAt, setCollectedAt] = useState(nowLocal());

  const chooseTest = (next: KnownLabTest) => {
    setTestName(next);
    // Follows the test unless the person has typed something of their own.
    setUnit((current) =>
      Object.values(KNOWN_LAB_UNITS).includes(current) || current === ''
        ? (KNOWN_LAB_UNITS[next] ?? '')
        : current,
    );
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.labs.create({
        testName,
        valueNumeric: Number(value),
        unit: unit || undefined,
        collectedAt: new Date(collectedAt),
        source: 'manual',
      }),
    onSuccess: () => {
      setValue('');
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
      // The findings that read these are recomputed on the next visit.
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
    },
  });

  return (
    <Form onSubmit={() => mutation.mutate()} mutation={mutation} label="Add result">
      <div>
        <label htmlFor="labTest" className="block text-sm text-ink-muted">
          Test
        </label>
        <select
          id="labTest"
          value={testName}
          onChange={(e) => chooseTest(e.target.value as KnownLabTest)}
          className="mt-1 w-full surface-raised px-3 py-2 text-sm text-ink"
        >
          {LAB_TESTS.map((test) => (
            <option key={test.value} value={test.value}>
              {test.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-4">
        <Input label="Result" type="number" step="0.1" value={value} onChange={setValue} required />
        <Input label="Unit" value={unit} onChange={setUnit} />
      </div>

      <Input
        label="When it was taken"
        type="datetime-local"
        value={collectedAt}
        onChange={setCollectedAt}
        required
      />
    </Form>
  );
}

function Form({
  children,
  onSubmit,
  mutation,
  label,
}: {
  children: React.ReactNode;
  onSubmit: () => void;
  mutation: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown };
  label: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      {children}

      {mutation.isError && (
        <p role="alert" className="text-sm text-zone-belowText">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Could not save.'}
        </p>
      )}
      {mutation.isSuccess && (
        <p className="text-sm text-evidence-strong">Saved to your timeline.</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending}
        className="btn btn-primary text-base"
      >
        {mutation.isPending ? 'Saving…' : label}
      </button>
    </form>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  step,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  required?: boolean;
}) {
  const id = `input-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex-1">
      <label htmlFor={id} className="block text-sm text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        type={type}
        step={step}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 w-full border-b border-rule bg-transparent pb-2 text-base text-ink focus:border-ink"
      />
    </div>
  );
}
