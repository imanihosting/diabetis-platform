import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { LoopSteps } from '@/components/marketing/LoopSteps';
import { Finding } from '@/components/marketing/Finding';
import { Boundaries } from '@/components/marketing/Boundaries';

export const metadata: Metadata = {
  title: 'How this works · Wellovue',
  description:
    'From a single reading to evidence you can check: the timeline, the pattern engine, safe experiments, and where a language model is and is not allowed near your data.',
};

export default function HowItWorksPage() {
  return (
    <MarketingShell>
      <PageHeader
        eyebrow="How this works"
        heading="From a reading to something you can check."
      >
        <p>
          Seven steps, in order. Each one is inspectable: you can always see what
          a conclusion was built from, and what it left out.
        </p>
      </PageHeader>

      <section className="mx-auto max-w-6xl px-7 pb-[clamp(2.5rem,6vw,4.5rem)] sm:px-6">
        <LoopSteps />
      </section>

      <Prose
        eyebrow="The rule that matters"
        heading="A model finds it. Language only phrases it."
        aside={
          <div className="mt-8">
            <Finding />
          </div>
        }
      >
        <p>
          Findings are produced by a statistical model. A language model is
          allowed to put one into a readable sentence. It is never allowed to
          create one, soften one, or fill a gap where the data is thin.
        </p>
        <p>
          That is why every finding arrives with a sample count, a confidence,
          and a list of what it does not account for. If those are missing, the
          finding is wrong by construction.
        </p>
        <p>
          When there is not enough data, you are told there is not enough data,
          along with what to record to change that. It is a worse-looking answer
          and a more useful one.
        </p>
      </Prose>

      <Prose
        eyebrow="Provenance"
        heading="Measured and estimated never look the same."
      >
        <p>
          A reading from a CGM and a carbohydrate figure you guessed at are not
          the same kind of fact, and the interface never lets them look like it.
          Anything the platform did not observe directly carries a confidence,
          and that confidence is shown next to it rather than folded into an
          average.
        </p>
        <p>
          The same applies to imports. Re-importing an overlapping export skips
          duplicates instead of overwriting them, so history cannot quietly
          change under you, and the original file is kept so any import can be
          replayed.
        </p>
      </Prose>

      <Prose
        eyebrow="Safety"
        heading="What is gated, and what is refused outright."
        aside={
          <div className="mt-8">
            <Boundaries />
          </div>
        }
      >
        <p>
          Experiments are classified before they can be started. Anything
          touching medication, fasting, or a major change is gated behind
          clinician review, and anything in the refused list cannot be created
          at all.
        </p>
        <p>
          These are database constraints, not copy. An unrecognised experiment
          template is treated as gated rather than allowed, so the failure
          direction is always the safe one.
        </p>
      </Prose>

      <Prose eyebrow="Your data" heading="Where it lives and what leaves.">
        <p>
          Health records are stored on infrastructure we control, not in a
          third-party analytics tool. Photos and imported files are kept in
          object storage under keys that reveal nothing about you, and reach
          your browser only through short-lived signed links.
        </p>
        <p>
          Every read and write of your record is logged to an append-only trail
          you can inspect from your own account. That trail cannot be edited,
          including by us, and if you ask to be erased it is your identity that
          is removed from it, not the record that something happened.
        </p>
        <p>
          Questions about any of this belong on the{' '}
          <Link
            href="/contact"
            className="text-[var(--ink)] underline underline-offset-4"
          >
            contact page
          </Link>
          .
        </p>
      </Prose>
    </MarketingShell>
  );
}
