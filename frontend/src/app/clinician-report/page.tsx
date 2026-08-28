import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { ClinicianBrief } from '@/components/marketing/ClinicianBrief';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/clinician-report');

/**
 * What comes out at the end, and who it is for.
 *
 * A product page rather than a health page: it describes an output of the
 * software, so it carries no `MedicalWebPage`. The distinction is the whole
 * discipline in `structured-data.ts` — a page can be full of clinical
 * vocabulary and still be marketing, and marking it as medical content
 * overstates what it is.
 */
export default function ClinicianReportPage() {
  return (
    <MarketingShell>
      <PageHeader
        eyebrow="Clinician report"
        heading="Ten minutes, and most of it spent establishing what happened."
      >
        <p>
          A diabetes appointment is short. Wellovue produces a summary of thirty
          or ninety days that a clinician can check rather than take on trust —
          the findings, what each was built from, and what the platform expected
          before it found out.
        </p>
      </PageHeader>

      <section className="mx-auto max-w-6xl px-7 pb-[clamp(2.5rem,6vw,4.5rem)] sm:px-6">
        <ClinicianBrief />
      </section>

      <Prose eyebrow="What is on it" heading="Findings, with their working shown.">
        <p>
          Each finding appears with the number of observations behind it, a
          confidence, and the list of things it does not account for. A finding
          the data could not support is included as exactly that, rather than
          dropped so the page looks stronger.
        </p>
        <p>
          Where a finding is a comparison — meals with activity against meals
          without, late meals against earlier ones — both groups are shown, with
          their glucose curves drawn against the target range and their
          post-meal measurements beside them: time to peak, minutes above range,
          and time back in range.
        </p>
      </Prose>

      <Prose
        eyebrow="The part worth the appointment"
        heading="What was predicted, beside what happened."
      >
        <p>
          When an experiment runs, the platform records what it expects before
          the experiment begins, and that record cannot be revised afterwards.
          The report shows it next to what was actually observed, and the
          difference between them.
        </p>
        <p>
          That is the number a clinician can use. It says how well this
          software&rsquo;s model of this particular person has held up, which is
          a far more useful thing to know than any single finding on the page.
        </p>
        <p>
          The engine build that produced each result is printed too. Two
          predictions made under different builds are not answers to the same
          question, and the report says which was which rather than quietly
          implying they are comparable.
        </p>
      </Prose>

      <Prose eyebrow="What it is not" heading="Not a referral, and not a conclusion.">
        <p>
          The report is a summary of a person&rsquo;s own records and what a
          statistical model found in them. It contains no diagnosis, no
          treatment recommendation, no medication or insulin guidance, and no
          instruction to the clinician reading it. Nothing in it should change
          care on its own.
        </p>
        <p>
          It is written to be argued with. Every number names what produced it,
          so a clinician who disagrees can see precisely where the disagreement
          is — which is the only reason a summary like this is worth carrying
          into a room.
        </p>
      </Prose>

      <Prose eyebrow="Next" heading="Where the numbers come from.">
        <p>
          <Link href="/how-it-works" className="text-[var(--ink)] underline underline-offset-4">How this works</Link> goes through the loop
          in order, and{' '}
          <Link href="/diabetes-intelligence" className="text-[var(--ink)] underline underline-offset-4">diabetes intelligence</Link>{' '}
          defines what is being measured.
        </p>
      </Prose>
    </MarketingShell>
  );
}
