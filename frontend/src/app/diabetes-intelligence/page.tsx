import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { Boundaries } from '@/components/marketing/Boundaries';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/diabetes-intelligence');

/**
 * What the phrase means here, in measurements rather than adjectives.
 *
 * "Diabetes intelligence" is the kind of phrase that usually means nothing,
 * and a health product that leans on it without saying what it computes has
 * told a reader only that it would like to sound advanced. So this page is
 * organised around the four things the engine actually measures and the one
 * thing it does with an association it finds. Every term on it — meal
 * response, activity effect, HbA1c trend, prediction, outcome — is a real
 * field in the engine's output, not a description of an ambition.
 */
export default function DiabetesIntelligencePage() {
  return (
    <MarketingShell>
      <PageHeader
        eyebrow="Diabetes intelligence"
        heading="A phrase is worth nothing. These are the measurements."
      >
        <p>
          Wellovue reads your own record — glucose, meals, activity, labs — and
          reports what it can measure in it, how sure it is, and what it could
          not account for. Where it finds an association, it offers you a way to
          test it rather than asking you to believe it.
        </p>
      </PageHeader>

      <Prose eyebrow="What it measures" heading="Four questions, asked of your data.">
        <p>
          <strong>Glucose patterns.</strong> What your readings do across a day
          and across a month: waking glucose, how much it varies between days,
          and how much of the time you spend inside your target range.
        </p>
        <p>
          <strong>Meal response.</strong> What happens after you eat — how high
          glucose went, how long it took to peak, how many minutes it spent
          above your target range, and when it came back. Measured on each
          meal&rsquo;s own curve and then averaged, so meals that peak at
          different times are not flattened into one shape that never happened.
        </p>
        <p>
          <strong>Activity effect.</strong> Whether meals followed by movement
          were followed by a different response from meals that were not, with
          both groups shown side by side rather than reduced to one number.
        </p>
        <p>
          <strong>HbA1c trend.</strong> The direction of your lab results over
          a longer window than the rest of the screen uses, because a quarterly
          test has nothing to say inside a month.
        </p>
      </Prose>

      <Prose
        eyebrow="The part most tools skip"
        heading="An association is a question, not an answer."
      >
        <p>
          If meals followed by a walk look different from meals without one,
          that is a real observation and a weak one. Those two groups differ in
          more than the walk: what you ate, when, how you slept, what kind of
          day it was. Wellovue says so, in the finding itself.
        </p>
        <p>
          So the finding comes with an offer. You run a short{' '}
          <strong>experiment</strong> — the same meal on six days, three of them
          followed by a walk, chosen at random rather than by how you feel. The
          platform writes down its <strong>prediction</strong> before the
          experiment starts, and the prediction cannot be edited afterwards.
          When you finish, the <strong>outcome</strong> is recorded beside it.
        </p>
        <p>
          That is the whole idea. A system that scores itself after the fact can
          always be right. One that writes down what it expects, then cannot
          touch it, produces the only number worth anything — how often it was
          right about you specifically.
        </p>
      </Prose>

      <Prose
        eyebrow="How sure it is"
        heading="Thin data produces a thin answer, and says so."
      >
        <p>
          Every finding carries the number of observations behind it, a
          confidence, and a list of what it does not account for. When there is
          not enough data, you are told there is not enough data and what to
          record to change that. It is a worse-looking answer and a more useful
          one.
        </p>
        <p>
          Findings are produced by a statistical model. A language model is
          allowed to phrase one into a readable sentence; it is never allowed to
          create one, soften one, or fill a gap where the record is thin.{' '}
          <Link href="/how-it-works" className="text-[var(--ink)] underline underline-offset-4">How this works</Link> goes through that in
          order.
        </p>
      </Prose>

      <Prose
        eyebrow="Boundaries"
        heading="What it will not do, whatever the data says."
      >
        <p>
          Wellovue is not a medical device. It does not diagnose, prescribe,
          calculate insulin doses, or take the place of clinical care. Some
          subjects are gated behind a conversation with your clinician no matter
          how clear a pattern looks.
        </p>
        <div className="not-prose mt-8">
          <Boundaries />
        </div>
      </Prose>

      <Prose eyebrow="Where to go next" heading="By what you are living with.">
        <p>
          <Link href="/type-2-diabetes" className="text-[var(--ink)] underline underline-offset-4">Type 2 diabetes</Link> and{' '}
          <Link href="/prediabetes" className="text-[var(--ink)] underline underline-offset-4">prediabetes</Link> describe what the engine
          reads in each kind of record.{' '}
          <Link href="/clinician-report" className="text-[var(--ink)] underline underline-offset-4">The clinician report</Link> is what
          comes out of it at the end of thirty or ninety days.
        </p>
      </Prose>
    </MarketingShell>
  );
}
