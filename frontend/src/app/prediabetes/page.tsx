import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { Boundaries } from '@/components/marketing/Boundaries';
import { pageMetadata } from '@/lib/seo';
import { jsonLdProps, medicalWebPageSchema } from '@/lib/structured-data';

export const metadata = pageMetadata('/prediabetes');

/**
 * What the engine reads in a prediabetes record.
 *
 * The second and last `MedicalWebPage`. The temptation on a page like this is
 * to write about outcomes — what might happen, what could be avoided — and
 * that is exactly the writing this product must not do. Prediabetes copy on
 * the open web is mostly either alarm or a promise, and both are claims about
 * a person nobody here has met.
 *
 * So it stays on the same ground as every other page: these are the five
 * things the engine measures in this kind of record, this is the window each
 * one needs, and this is what it refuses to say.
 */
export default function PrediabetesPage() {
  return (
    <MarketingShell>
      <script {...jsonLdProps(medicalWebPageSchema('/prediabetes'))} />

      <PageHeader
        eyebrow="Prediabetes"
        heading="Slow-moving numbers, read over the window they actually move in."
      >
        <p>
          General information about what Wellovue measures in a prediabetes
          record. It is not medical advice and it does not diagnose. A
          prediabetes result comes from your clinician, not from this software.
        </p>
      </PageHeader>

      <Prose
        eyebrow="The difficulty"
        heading="Nothing here changes inside a month."
      >
        <p>
          HbA1c is taken quarterly. Weight moves over months. Whether activity
          has become a habit is not a question a week can answer. A tool that
          reads a prediabetes record on a thirty-day window will find nothing
          and report it as though nothing were there.
        </p>
        <p>
          So the lab detectors read a longer span than the rest of the screen
          and say which span they used. Two results are a difference; three are
          the beginning of a direction, and below that Wellovue says so instead
          of drawing a line.
        </p>
      </Prose>

      <Prose eyebrow="What it measures" heading="Five things, each on its own clock.">
        <p>
          <strong>HbA1c trend.</strong> The direction across your recorded
          results, in whatever unit they were recorded in. Results in two
          different units are refused rather than trended, because 7% and 53
          mmol/mol are the same reading on scales an order of magnitude apart.
        </p>
        <p>
          <strong>Fasting glucose trend.</strong> Waking readings over time,
          read on your own clock so a morning is your morning.
        </p>
        <p>
          <strong>Weight trend.</strong> Reported per month, because that is the
          period over which the number means something.
        </p>
        <p>
          <strong>Activity consistency.</strong> How regular movement has been,
          over at least a fortnight — anything shorter describes a week rather
          than a habit.
        </p>
        <p>
          <strong>Meal timing.</strong> Whether the hour you eat is associated
          with a different glucose response, stated as an association and
          offered as something you can test.
        </p>
      </Prose>

      <Prose
        eyebrow="What you get back"
        heading="A direction, a confidence, and what it cannot account for."
      >
        <p>
          Every finding carries how many results it was built from and what it
          did not consider. A trend across three lab results is reported as a
          trend across three lab results, not as a conclusion.
        </p>
        <p>
          Where an association turns up that a week of deliberate variation
          could actually settle, Wellovue offers an experiment and records what
          it expects before you begin.{' '}
          <Link href="/diabetes-intelligence" className="text-[var(--ink)] underline underline-offset-4">Diabetes intelligence</Link>{' '}
          explains that loop.
        </p>
      </Prose>

      <Prose eyebrow="Boundaries" heading="What Wellovue will not do.">
        <p>
          Wellovue does not diagnose prediabetes or tell you whether you have
          it. It does not prescribe, adjust medication, calculate insulin doses,
          or replace clinical care. It will not tell you what your results mean
          for your future health — that conversation belongs with your
          clinician, and this is built to make it a better one.
        </p>
        <div className="not-prose mt-8">
          <Boundaries />
        </div>
      </Prose>

      <Prose eyebrow="Next" heading="Where this goes.">
        <p>
          <Link href="/how-it-works" className="text-[var(--ink)] underline underline-offset-4">How this works</Link> walks the loop end to
          end. <Link href="/clinician-report" className="text-[var(--ink)] underline underline-offset-4">The clinician report</Link> is the
          summary you can bring to an appointment.
        </p>
      </Prose>
    </MarketingShell>
  );
}
