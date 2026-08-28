import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { Boundaries } from '@/components/marketing/Boundaries';
import { pageMetadata } from '@/lib/seo';
import { jsonLdProps, medicalWebPageSchema } from '@/lib/structured-data';

export const metadata = pageMetadata('/type-2-diabetes');

/**
 * What the engine reads in a type 2 record.
 *
 * One of two pages carrying `MedicalWebPage`, because it explains something
 * about the condition rather than only about the software. That schema is a
 * claim about what this page is, so the page has to earn it: general
 * information, no advice, and the boundary stated on the page rather than left
 * to the footer.
 *
 * Everything named here is a detector that exists and runs today. Type 1 and
 * gestational are deliberately absent — they are parked behind clinical review
 * (HANDOVER §11), and a page implying otherwise would be the exact failure §7
 * of the handover exists to prevent.
 */
export default function Type2DiabetesPage() {
  return (
    <MarketingShell>
      <script {...jsonLdProps(medicalWebPageSchema('/type-2-diabetes'))} />

      <PageHeader
        eyebrow="Type 2 diabetes"
        heading="Your own record, read as a body rather than a spreadsheet."
      >
        <p>
          General information about what Wellovue measures in a type 2 record.
          It is not medical advice, it does not diagnose, and nothing here
          should change anything about your treatment without your clinician.
        </p>
      </PageHeader>

      <Prose
        eyebrow="After a meal"
        heading="How high, how fast, how long, and when it came back."
      >
        <p>
          A rise of 3.1 mmol/L is a statistic. Peaking at 11.2 an hour after
          eating, spending fifty minutes above your target range and coming back
          under it at ninety-five minutes is the same meal described in the
          language the condition is actually lived in.
        </p>
        <p>
          Wellovue measures each meal&rsquo;s response on its own curve — time
          to peak, minutes above target range, time back in range — and then
          averages across meals. A meal that was not watched for long enough to
          say when glucose came back is left out of those timings rather than
          guessed at, and the page tells you how many meals it could actually
          measure.
        </p>
      </Prose>

      <Prose
        eyebrow="Movement"
        heading="Whether a walk after eating did anything for you."
      >
        <p>
          Meals followed by activity are compared against meals that were not,
          with both curves drawn against your target range. The finding says
          plainly that this is an observed association rather than a controlled
          comparison, because the two groups differ in more than the walk.
        </p>
        <p>
          If the difference looks worth knowing, you can test it: a short
          experiment where the walk is assigned at random rather than chosen on
          the days you already feel well.
        </p>
      </Prose>

      <Prose eyebrow="Timing" heading="Late meals, and mornings.">
        <p>
          Meals after 20:00 are compared with earlier ones, read on your own
          clock rather than the server&rsquo;s. Waking glucose is described
          across the 05:00–09:00 window, with how much it varies between days
          and how many mornings sat above your target range.
        </p>
        <p>
          A persistently raised morning pattern is flagged as worth raising with
          your clinician. Wellovue surfaces it; it does not interpret it, and it
          never suggests what to do about it.
        </p>
      </Prose>

      <Prose eyebrow="Over months" heading="HbA1c trend, on its own timescale.">
        <p>
          HbA1c is taken quarterly, so a thirty-day window would show one result
          or none. Lab trends are read over a longer span and say which span
          they used, because it is not the one the rest of the screen is
          showing. A trend across results recorded in two different units is
          refused rather than drawn.
        </p>
      </Prose>

      <Prose
        eyebrow="Boundaries"
        heading="What Wellovue will not do."
      >
        <p>
          Wellovue is not a medical device and is not a substitute for clinical
          care. It does not diagnose, prescribe, or calculate insulin doses, and
          it will not advise you during a hypo or a hyper. Some subjects are
          gated behind a clinician conversation regardless of what the data
          shows.
        </p>
        <div className="not-prose mt-8">
          <Boundaries />
        </div>
        <p className="mt-8">
          Findings for type 1 and gestational diabetes are not offered. The
          engine models type 2 physiology, and running it over a record it was
          not built for would produce confident answers from the wrong model of
          a body. That gate stays until clinical review lifts it.
        </p>
      </Prose>

      <Prose eyebrow="Next" heading="How the loop actually runs.">
        <p>
          <Link href="/how-it-works" className="text-[var(--ink)] underline underline-offset-4">How this works</Link> walks the seven steps
          from a reading to a checkable finding.{' '}
          <Link href="/diabetes-intelligence" className="text-[var(--ink)] underline underline-offset-4">Diabetes intelligence</Link>{' '}
          defines the terms.{' '}
          <Link href="/clinician-report" className="text-[var(--ink)] underline underline-offset-4">The clinician report</Link> is what you
          can take to an appointment.
        </p>
      </Prose>
    </MarketingShell>
  );
}
