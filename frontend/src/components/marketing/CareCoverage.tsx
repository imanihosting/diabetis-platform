import {
  DIAGNOSED_CARE_MODES,
  careModeCapabilities,
  careModeLabel,
} from '@wellovue/types';

/**
 * Which kinds of diabetes this platform records, and where it will interpret.
 *
 * The distinction is the honest answer to "is this for me", and stating it
 * badly in either direction does real harm. Claiming the platform is Type 2
 * software hides that the record, the safety rules, the timeline and the
 * clinician summary are built for every kind of diabetes and work today.
 * Claiming it covers everyone would send somebody with Type 1 to a screen that
 * refuses to produce findings for them, having promised otherwise.
 *
 * So the table is computed rather than written. `careModeCapabilities` is the
 * same function the API calls before deciding whether to ask the engine
 * anything, and `unsupportedReason` is the same sentence the person is shown
 * in the product. When a reviewed detector for Type 1 lands and the contract
 * changes, this page changes with it — nobody has to remember to come back
 * and edit a marketing claim, which is exactly the kind of promise that rots.
 */
export function CareCoverage() {
  const modes = DIAGNOSED_CARE_MODES.map((careMode) => ({
    label: careModeLabel(careMode),
    // No safety flags: this is the baseline for each care mode rather than a
    // statement about any particular person's record.
    ...careModeCapabilities(careMode, []),
  }));

  return (
    <div className="border border-[var(--rule)] bg-[var(--paper-raised)]">
      <div className="border-b border-[var(--rule)] px-6 py-4 sm:px-8">
        <h3 className="text-sm font-semibold">Where findings are produced today</h3>
        <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-[var(--ink-muted)]">
          Everything else — your record, the timeline, medication and labs, the
          safety rules, and the summary for an appointment — is built for every
          kind of diabetes and works now.
        </p>
      </div>

      <ul className="divide-y divide-[var(--rule)]">
        {modes.map((mode) => (
          <li key={mode.careMode} className="px-6 py-4 sm:px-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="text-[0.95rem] text-[var(--ink)]">{mode.label}</p>
              <p
                className={
                  mode.evidenceEnabled
                    ? 'text-sm text-[var(--in-range-text)]'
                    : 'text-sm text-[var(--ink-faint)]'
                }
              >
                {/* The colour is never the only signal; the words carry it. */}
                {mode.evidenceEnabled ? 'Findings today' : 'Recorded, not yet interpreted'}
              </p>
            </div>

            {mode.unsupportedReason && (
              // The engine's own sentence, not a marketing paraphrase of it.
              // This is what the person is told inside the product, so the
              // page cannot promise something softer than the screen.
              <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-[var(--ink-muted)]">
                {mode.unsupportedReason}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
