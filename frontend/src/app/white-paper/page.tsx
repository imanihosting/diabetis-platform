import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { LoopSteps } from '@/components/marketing/LoopSteps';
import { CareCoverage } from '@/components/marketing/CareCoverage';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/white-paper');

/**
 * The platform in depth, for someone evaluating it rather than using it.
 *
 * Three rules govern what is on this page, and they are the same rules that
 * govern every other public page here.
 *
 * Nothing is claimed that is not built. Section 7 of the handover exists
 * because a health product that overstates itself has already told the reader
 * something, and the reader most likely to check is the one this page is
 * written for. The status table is therefore first-class content rather than
 * an appendix, and it names what is missing before anything else makes a case.
 *
 * No numbers are invented. There is no market sizing, no revenue projection,
 * no user count, and no funding ask, because none of those exist yet and a
 * paper that manufactured them would be doing precisely what the product is
 * built to stop people doing with their own data.
 *
 * The voice does not change for this audience. PRODUCT.md puts the person with
 * the condition first and the clinician second; an investor is a third reader,
 * and writing this page in a register the other two would not recognise would
 * make it a different company's document.
 */
export default function WhitePaperPage() {
  return (
    <MarketingShell>
      <PageHeader
        eyebrow="White paper"
        heading="A diabetes platform built to be wrong in public."
      >
        <p>
          Most diabetes software records what happened. Wellovue is built to
          work out what is likely true for one person&rsquo;s body, state how
          confident anyone should be about it, and propose the next safe
          observation that would reduce the uncertainty.
        </p>
        <p>
          The mechanism that makes that more than a slogan is unglamorous: the
          system writes down what it expects before a trial begins, cannot edit
          it afterwards, and scores itself against it. Over time that produces a
          number almost nothing in this category has — how often it was right
          about you specifically.
        </p>
      </PageHeader>

      <Prose eyebrow="The problem" heading="A record is not an answer.">
        <p>
          Nobody living with diabetes lacks numbers. Meters, continuous
          monitors and apps produce them continuously. What is missing is the
          step from data to a decision: whether the walk after dinner was worth
          the twelve minutes, whether eating earlier actually did anything,
          whether the change last month held.
        </p>
        <p>
          Population guidance is a reasonable starting point and a poor stopping
          point. The effect of meal timing, of a short walk, of composition,
          varies enormously between people, and nothing tells an individual in
          advance which side of that variation they are on. The standard product
          response is to ask for more logging, which produces a longer record
          and the same absence of an answer.
        </p>
        <p>
          The clinical consequence is a ten-minute appointment spent
          reconstructing three months from memory and screenshots.
        </p>
      </Prose>

      <Prose eyebrow="The approach" heading="Treat one person&rsquo;s data as evidence about that person.">
        <p>
          Everything recorded lands on a single timeline carrying its source and,
          where a value was estimated, how confident that estimate is. A
          statistical model looks for repeatable associations and reports each
          one with an effect estimate, a confidence, a sample count, and an
          explicit list of what it does not account for.
        </p>
        <p>
          Where a pattern is interesting but uncertain, the platform proposes a
          small experiment that could settle it — the same meal over six days,
          walking after three of them, chosen at random rather than by mood.
          Starting it writes down what the system expects to happen. That record
          is immutable, attributed to the specific engine build that produced
          it, and cannot be revised once the answer is known.
        </p>
        <p>
          When the trial ends, the measured result is scored against that
          expectation. Both halves are frozen, so the accuracy record is the one
          thing in the product nobody can improve after the fact.
        </p>
      </Prose>

      <section className="border-t border-[var(--rule)] py-[clamp(2.75rem,6vw,5rem)]">
        <div className="mx-auto max-w-6xl px-7 sm:px-8">
          <p className="text-sm text-[var(--ink-faint)]">The loop</p>
          <h2 className="mt-3 max-w-[24ch] text-fold font-semibold text-balance">
            Seven steps, and the one still missing is named.
          </h2>
          <p className="mt-6 max-w-[62ch] text-lede leading-relaxed text-[var(--ink-muted)]">
            This is the product, and the same list appears on{' '}
            <Link href="/how-it-works" className="underline underline-offset-4">
              How this works
            </Link>{' '}
            with the same labels. A step marked as being built is being built.
          </p>
          <div className="mt-10">
            <LoopSteps />
          </div>
        </div>
      </section>

      <Prose
        eyebrow="Who it is for"
        heading="A diabetes platform, not a Type 2 app."
        aside={
          <div className="mt-8">
            <CareCoverage />
          </div>
        }
      >
        <p>
          <strong className="font-semibold text-[var(--ink)]">
            The record is diabetes-wide, and it is built that way today.
          </strong>{' '}
          Type 1, Type 2 with and without insulin, gestational, prediabetes and
          clinician-classified forms are all first-class in the data model.
          Everyone gets the timeline, glucose and CGM import, meals, medication,
          activity, labs and body measurements, the audit trail, erasure, and
          the summary for an appointment. The safety rules cover every care
          mode, including a pregnancy tier and recognition of whether insulin is
          in the picture, because those change what may be proposed.
        </p>
        <p>
          <strong className="font-semibold text-[var(--ink)]">
            Interpretation is narrower, and stated rather than implied.
          </strong>{' '}
          Reviewed detectors exist for Type 2 and prediabetes. For the others
          the platform records everything and declines to interpret — twice,
          once at the API and once independently in the engine — and says why on
          the screen where findings would otherwise appear.
        </p>
        <p>
          That gap is a decision, not an oversight. Every detector models Type 2
          physiology; running them over a Type 1 or a pregnancy record would
          produce confident findings from the wrong model of a body, and the
          person reading them would have no way to tell. The engine is built as
          a registry where each detector declares the care modes it is valid
          for, so adding Type 1 is adding detectors and a review, not
          rearchitecting. Until that review happens the honest answer is a
          refusal, and the panel opposite is generated from the same function
          the product uses to decide.
        </p>
        <p>
          <strong className="font-semibold text-[var(--ink)]">
            The clinician is the second reader throughout.
          </strong>{' '}
          The thirty or ninety day summary — findings with their limitations,
          glucose, lab trends, every experiment beside the expectation recorded
          before it ran, and what is worth raising — is produced for any care
          mode. Where findings do not exist yet it says so in place of them,
          rather than printing an empty section a clinician would read as
          &ldquo;nothing was found&rdquo;.
        </p>
      </Prose>

      <Prose eyebrow="What is different" heading="Three claims, each enforced rather than promised.">
        <p>
          <strong className="font-semibold text-[var(--ink)]">
            The prediction precedes the trial, and the database enforces it.
          </strong>{' '}
          An experiment cannot become active without an expectation attached to
          it, and cannot be completed without a measurement recorded against
          that expectation. Neither can be edited or deleted afterwards while it
          belongs to somebody. These are triggers and check constraints, tested
          by attacking them directly over SQL rather than through the code that
          happens to be calling.
        </p>
        <p>
          <strong className="font-semibold text-[var(--ink)]">
            A finding comes from a model, never from a language model.
          </strong>{' '}
          Findings are produced by statistical detectors. A language model may
          phrase an existing finding; it is never permitted to create one. When
          the data is thin the answer is that the data is thin, together with
          what to log to change that.
        </p>
        <p>
          <strong className="font-semibold text-[var(--ink)]">
            Safety is a schema, not a policy.
          </strong>{' '}
          Experiments are classified against the person&rsquo;s care profile
          before anything starts. Anything touching medication, fasting or a
          major change is gated behind clinician review. Insulin dosing is
          refused outright and always will be — not because it is hard, but
          because it should not be product-mediated at all. An unrecognised
          template is treated as gated rather than allowed, so the failure
          direction is always the safe one.
        </p>
      </Prose>

      <Prose eyebrow="How it is built" heading="Three services, one contract, one rule about who owns what.">
        <p>
          A Next.js front end, a NestJS API owning application state and
          workflow, and a Python engine owning scientific computation. Neither
          of the last two reaches into the other. A shared, typed contract is
          compiled against by all three, so the API, the interface and the
          clinician summary cannot disagree about what a finding is or how firm
          it is.
        </p>
        <p>
          Data sits in PostgreSQL with TimescaleDB for dense measurement series
          and pgvector for retrieval, across eleven domain schemas and twenty
          migrations. Six guard triggers enforce the invariants above. Object
          storage holds photos and imports under keys that reveal nothing about
          a person and reach a browser only through short-lived signed links.
        </p>
        <p>
          Every read and write of a health record is written to an append-only
          audit trail, in the same transaction as the write it describes. Erasure
          removes a person&rsquo;s identity from that trail without deleting the
          record that something happened — which is what lets the right to be
          forgotten coexist with an audit log worth having.
        </p>
      </Prose>

      <Prose eyebrow="Evidence" heading="The engine is checked against an answer we control.">
        <p>
          The demonstration dataset encodes a known ground truth: walking after a
          meal blunts the rise by 1.3 mmol/L. The engine, given that data,
          recovers about 1.05 — close enough to be working, different enough to
          be a real estimator rather than a lookup. A detector that returned the
          seeded number exactly would be evidence of a bug, not of accuracy.
        </p>
        <p>
          The platform carries 105 unit tests, 184 integration tests against a
          real PostgreSQL with the production extension versions, and 104 engine
          tests with strict type checking. The suites worth naming are the ones
          that attack the product rather than exercise it: one drives the
          database&rsquo;s guarantees directly over SQL, and one calls the
          engine over HTTP bypassing the API entirely, because everything else
          reaches the engine through a caller that never sends the request the
          engine is supposed to refuse.
        </p>
      </Prose>

      <Prose eyebrow="Boundaries" heading="What it will not do, in the system rather than the copy.">
        <p>
          Wellovue is not a medical device. It does not diagnose, does not adjust
          medication, and does not advise in an emergency. It helps a person
          understand patterns in their own data and prepare for a conversation
          with a clinician.
        </p>
        <p>
          Those limits are enforced where they cannot be argued with. A blocked
          experiment is recorded, answered, and can never run. A clinician-gated
          one waits, and the product says plainly that there is no queue anybody
          is working through, because there is not one yet.
        </p>
        <p>
          Regulatory review has not started. The prediction and outcome loop is
          the part most likely to attract it, and the honest position is that it
          is a known and unresolved question rather than a solved one.
        </p>
      </Prose>

      <Prose eyebrow="Status" heading="What exists today, and what does not.">
        <p>
          The record is diabetes-wide and working: every type representable,
          one timeline, ingestion of glucose by hand and by CGM or meter import,
          meals, medication, activity, labs and body measurements, the safety
          classifier across every care mode, the audit trail, erasure, and the
          clinician summary. Database TLS is verified against an internal
          certificate authority and rate limits are shared across replicas.
        </p>
        <p>
          The full evidence loop — findings, a safety-checked proposal, a
          recorded prediction, a measured outcome — is closed for Type 2 and
          prediabetes.
        </p>
        <p>
          Not built: reviewed detectors for Type 1, gestational and
          clinician-classified diabetes, all behind clinical review; weighing
          competing explanations for a pattern against each other, the last loop
          step still marked as such publicly; recording a clinician&rsquo;s
          agreement, so gated experiments can proceed; exporting the clinician
          summary as a file; and sleep capture.
        </p>
        <p>
          Two launch items remain and neither is code: a reverse proxy so
          address-keyed rate limits see real client addresses, and legal review
          of the privacy and terms pages, which still carry marked placeholders
          and cannot ship while they do — a check in the release pipeline fails
          if they are still there.
        </p>
      </Prose>

      <Prose eyebrow="Risks" heading="The four that would actually matter.">
        <p>
          <strong className="font-semibold text-[var(--ink)]">Regulatory.</strong>{' '}
          A system that predicts and scores metabolic outcomes may attract
          medical device classification in some jurisdictions. Unstarted.
        </p>
        <p>
          <strong className="font-semibold text-[var(--ink)]">Clinical.</strong>{' '}
          Interpretation beyond Type 2 and prediabetes is gated on clinical
          review that has not happened. The record and the safety model already
          cover those people; the findings do not. This is a deliberate
          constraint on growth and the largest single piece of unrealised
          scope.
        </p>
        <p>
          <strong className="font-semibold text-[var(--ink)]">Evidential.</strong>{' '}
          The accuracy record is the product&rsquo;s central claim and it is
          empty until real people run real experiments. The machinery to produce
          it honestly exists; the record itself does not.
        </p>
        <p>
          <strong className="font-semibold text-[var(--ink)]">Commercial.</strong>{' '}
          The platform is pre-revenue and pre-user. Nothing here has been tested
          against willingness to pay.
        </p>
      </Prose>

      <Prose eyebrow="What this paper is not" heading="No market sizing, no projections, no ask.">
        <p>
          This document covers what the platform does, who it is for, how it is
          built, and what is not finished. It does not contain a market estimate,
          a revenue model, a user count, or a funding requirement, because none
          of those exist yet and manufacturing them here would be the same
          failure the product is built to prevent people making with their own
          data.
        </p>
        <p>
          Those are conversations rather than documents.{' '}
          <Link href="/contact" className="underline underline-offset-4">
            Get in touch
          </Link>{' '}
          and they can be had directly.
        </p>
      </Prose>
    </MarketingShell>
  );
}
