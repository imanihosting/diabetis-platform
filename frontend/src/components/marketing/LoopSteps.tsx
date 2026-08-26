const STEPS = [
  {
    n: 1,
    title: 'Collect',
    body: 'Readings from your meter or CGM, meals, medication, movement and sleep. Import a CSV, or type one in.',
  },
  {
    n: 2,
    title: 'One timeline',
    body: 'Everything in the order it happened, each entry carrying its source and, when it was estimated, how confident that estimate is.',
  },
  {
    n: 3,
    title: 'Find patterns',
    body: 'A statistical model looks for repeatable associations: post-meal responses, morning glucose, what follows a walk.',
  },
  {
    n: 4,
    title: 'Weigh the explanations',
    body: 'A pattern usually has more than one cause. Competing explanations are kept side by side rather than collapsed into one story.',
  },
  {
    n: 5,
    title: 'Propose a safe test',
    body: 'Where uncertainty is worth resolving, you get a small experiment you can run in a week, and a prediction recorded before it starts.',
  },
  {
    n: 6,
    title: 'Measure the result',
    body: 'What happened is compared against what was predicted. The prediction cannot be edited afterwards, so the score is real.',
  },
  {
    n: 7,
    title: 'Turn it into evidence',
    body: 'What held up becomes something you can act on, and something your clinician can read in a minute.',
  },
];

/**
 * The product loop as a numbered sequence.
 *
 * A list rather than a diagram: the order is the argument, and a diagram would
 * decorate it without adding anything a reader could not already follow.
 */
export function LoopSteps() {
  return (
    <ol className="border-t border-[var(--brand-rule)]">
      {STEPS.map((step) => (
        <li
          key={step.n}
          className="grid gap-x-8 gap-y-2 border-b border-[var(--brand-rule)] py-6 sm:grid-cols-12"
        >
          <p className="measure text-sm text-[var(--brand-ink-3)] sm:col-span-1">
            {String(step.n).padStart(2, '0')}
          </p>
          <h3 className="text-lede font-semibold text-[var(--brand-ink)] sm:col-span-3">
            {step.title}
          </h3>
          <p className="max-w-[62ch] leading-relaxed text-[var(--brand-ink-2)] sm:col-span-8">
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
