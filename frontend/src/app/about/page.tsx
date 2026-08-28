import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/about');

export default function AboutPage() {
  return (
    <MarketingShell>
      <PageHeader
        eyebrow="About"
        heading="Built for the question a tracker cannot answer."
      >
        <p>
          If you live with diabetes you already have numbers. What you usually
          do not have is a way to tell which of the things you changed actually
          did anything.
        </p>
      </PageHeader>

      <Prose eyebrow="The problem" heading="Advice is general. Bodies are not.">
        <p>
          Most guidance is written for a population. It is a reasonable starting
          point and a poor stopping point, because the effect of a late dinner,
          a walk, or a change in timing varies enormously between people, and
          nobody can tell you in advance which side of that variation you are on.
        </p>
        <p>
          The usual answer is to log more. But logging produces a record, and a
          record is not an answer. Nothing in a food diary tells you whether the
          walk was worth the twelve minutes.
        </p>
      </Prose>

      <Prose eyebrow="The approach" heading="Treat your own data as evidence.">
        <p>
          Everything you record goes onto one timeline, with its source attached.
          Patterns are found by a statistical model, reported with a sample count
          and a confidence, and stated alongside what they do not account for.
        </p>
        <p>
          When a pattern is interesting but uncertain, the answer is a small
          experiment you can actually run: the same breakfast for six days,
          walking after three of them. The prediction is written down first and
          cannot be edited afterwards, so over time you accumulate a record of
          how often this system was right about you in particular.
        </p>
      </Prose>

      <Prose eyebrow="Who it is for" heading="You first. Your clinician second.">
        <p>
          The person this is built for is the one living with the condition. Every
          finding is written to be read by them, not summarised for them.
        </p>
        <p>
          Your clinician sees a version of the same thing: ninety days on one
          page, with what you tested and what it showed. Ten minutes is not
          enough time to explain a year, and a stack of screenshots does not
          help. This is the part that makes the appointment better.
        </p>
      </Prose>

      <Prose eyebrow="Limits" heading="What we will not build.">
        <p>
          This will not adjust your medication, calculate an insulin dose,
          diagnose a complication, or advise you during a hypo. Those limits are
          enforced in the system itself: an experiment marked as needing
          clinician review cannot be started without it, and a prediction, once
          made, cannot be quietly rewritten to look better.
        </p>
        <p>
          It also will not claim to reverse anything. There is a lot of that
          about, and it is not a claim the evidence supports.
        </p>
        <p>
          <Link
            href="/how-it-works"
            className="text-[var(--ink)] underline underline-offset-4"
          >
            How this works
          </Link>{' '}
          goes through the whole loop, from a single reading to something worth
          bringing to an appointment.
        </p>
      </Prose>

      <Prose eyebrow="Where it is" heading="Further along than it was, and honest about the rest.">
        <p>
          The record works for every kind of diabetes: the timeline, imports
          from a meter or CGM, meals, medication, activity and labs, the safety
          rules, and the summary you bring to an appointment.
        </p>
        <p>
          The loop is closed for Type 2 and prediabetes. A finding can propose
          the test that would settle it, starting that test writes down what
          Wellovue expects before you begin, and the result is scored against
          it. Neither half can be edited afterwards.
        </p>
        <p>
          Wellovue knows which kind of diabetes it is reading for and refuses to
          interpret the ones it has no reviewed model for — Type 1, gestational
          and clinician-classified forms are recorded and not yet interpreted.
          Weighing competing explanations for a pattern is still being built.
        </p>
        <p>
          If you want to use it now, bring a CSV from your meter or CGM. If you
          would rather wait, leave an address on the{' '}
          <Link href="/" className="text-[var(--ink)] underline underline-offset-4">
            home page
          </Link>{' '}
          and we will write when there is something worth writing about.
        </p>
      </Prose>
    </MarketingShell>
  );
}
