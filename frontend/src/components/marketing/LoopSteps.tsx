/**
 * The loop, with the parts that do not exist yet marked as not existing.
 *
 * The loop is the product thesis and describing it is honest. Describing it in
 * the present tense when half of it is unbuilt is not, and this product's own
 * position is that showing the limits is the trust signal rather than a
 * disclaimer to bury. A reader who signs up expecting step five and finds it
 * missing has been told something about the product that no amount of careful
 * copy elsewhere can undo.
 *
 * `building` is what marks a step as unbuilt, and no step carries it now:
 * step four was the last, and it came off when competing explanations shipped.
 * The flag stays because the next unbuilt step will need it, and because
 * deleting the mechanism is how a product ends up with no way to say "not yet"
 * at the moment it most needs one. Put it back before describing something
 * that does not exist, not after.
 */
interface Step {
  n: number;
  title: string;
  body: string;
  /** Set on a step that is described but not built. See the note above. */
  building?: boolean;
}

const STEPS: Step[] = [
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
    body: 'A pattern usually has more than one cause. Every finding carries the other reasons that could produce it, each saying what would show it up, what is missing from your record, and whether that is something you can start logging — from a reviewed list, never written on the spot.',
  },
  {
    n: 5,
    title: 'Propose a safe test',
    body: 'Where uncertainty is worth resolving, a small experiment you can run in a week. Every proposal is checked against your care profile first, and some are refused outright. Starting one writes down what is expected of it in the same moment, and that cannot be edited afterwards.',
  },
  {
    n: 6,
    title: 'Measure the result',
    body: 'What happened, beside what was predicted, and the gap between them. Neither side can be revised once written — the database refuses it — so the record of how often this was right about you is the one thing here nobody can improve after the fact.',
  },
  {
    n: 7,
    title: 'Turn it into evidence',
    body: 'Thirty or ninety days on one page: what was found, what was tested against a prediction, what it does not account for, and what is worth raising. Yours to bring, and readable in a minute.',
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
    <ol className="border-t border-[var(--rule)]">
      {STEPS.map((step) => (
        <li
          key={step.n}
          className="grid gap-x-8 gap-y-2 border-b border-[var(--rule)] py-6 sm:grid-cols-12"
        >
          <p className="measure text-sm text-[var(--ink-faint)] sm:col-span-1">
            {String(step.n).padStart(2, '0')}
          </p>
          <h3 className="text-lede font-semibold text-[var(--ink)] sm:col-span-3">
            {step.title}
            {step.building && (
              <span className="mt-1 block text-sm font-normal text-[var(--ink-faint)]">
                Being built
              </span>
            )}
          </h3>
          <p className="max-w-[62ch] leading-relaxed text-[var(--ink-muted)] sm:col-span-8">
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
