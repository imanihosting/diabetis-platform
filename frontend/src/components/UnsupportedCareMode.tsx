import Link from 'next/link';
import type { StructuredFinding } from '@wellovue/types';

/**
 * What the Evidence screen shows when the platform will not interpret the data.
 *
 * Deliberately not a finding card. A finding card carries an effect estimate, a
 * sample count and an evidence badge, and dressing a refusal in that furniture
 * implies a measurement was attempted and came back weak. Nothing was measured.
 * The honest shape is a statement with a route out of it.
 *
 * Not an error state either. Nothing failed: the platform was asked a question
 * about a body it has not been told enough about, and declining is the correct
 * answer rather than a fault. Errors invite a retry, and retrying changes
 * nothing here.
 *
 * The engine's own sentence is used verbatim. The reason a care mode is
 * unsupported is a fact about the analysis, and rewording it on the way to the
 * screen is how a careful statement becomes a vague one.
 */
export function UnsupportedCareMode({
  finding,
  needsSetup,
}: {
  finding: StructuredFinding;
  needsSetup: boolean;
}) {
  return (
    <section className="border border-rule bg-paper-raised p-6">
      <h2 className="text-sm font-medium text-ink">
        {needsSetup
          ? 'Wellovue has not been told what to read'
          : 'Not interpreted here yet'}
      </h2>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
        {finding.summary}
      </p>

      {finding.limitations.length > 0 && (
        <ul className="mt-5 space-y-1.5 border-t border-rule pt-4">
          {finding.limitations.map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-relaxed text-ink-faint">
              <span aria-hidden>&#8213;</span>
              {item}
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/profile"
        className="mt-6 inline-flex min-h-[2.75rem] items-center bg-ink px-5 text-sm font-medium text-paper transition-opacity hover:opacity-85"
      >
        {needsSetup ? 'Answer the question' : 'Review your care profile'}
      </Link>

      <p className="mt-4 max-w-prose text-xs leading-relaxed text-ink-faint">
        Your readings are still being recorded either way. Nothing has been lost,
        and none of it has been interpreted using a model built for someone
        else&rsquo;s physiology.
      </p>
    </section>
  );
}
