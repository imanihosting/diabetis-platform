import Link from 'next/link';
import { DayTrace } from '@/components/marketing/DayTrace';
import { Fold } from '@/components/marketing/Fold';
import { Finding } from '@/components/marketing/Finding';
import { Reveal } from '@/components/marketing/Reveal';
import { TimelineExcerpt } from '@/components/marketing/TimelineExcerpt';
import { Boundaries } from '@/components/marketing/Boundaries';
import { CareCoverage } from '@/components/marketing/CareCoverage';
import { ClinicianBrief } from '@/components/marketing/ClinicianBrief';
import { EmailCapture } from '@/components/marketing/EmailCapture';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { CREATE_ACCOUNT_HREF } from '@/lib/navigation';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/');

export default function LandingPage() {
  return (
    <MarketingShell>
      {/* ---- Hero -------------------------------------------------------- */}
      {/*
        The trace is the hero, not an illustration under one.

        Everything else on this page is ink on paper; the day's trace against
        its target band is the only place colour appears at size, which makes
        it the product object by construction rather than by decoration. It
        used to sit below a finished headline like a figure in a report. Now
        the statement opens above it, the trace runs at full width, and the
        line that resolves the sentence sits underneath — so a reader meets the
        thing before they finish reading about it.
      */}
      <section className="mx-auto max-w-6xl px-7 pb-[clamp(3.5rem,8vw,7rem)] pt-[clamp(1.5rem,4vw,3.5rem)] sm:px-8">
        <Reveal>
          <h1 className="max-w-[17ch] text-statement font-semibold text-balance">
            Most diabetes tools tell you what happened.
          </h1>
        </Reveal>

        <Reveal delay={140}>
          <div className="mt-[clamp(2rem,4.5vw,3.5rem)]">
            <DayTrace />
          </div>
        </Reveal>

        <Reveal delay={220}>
          <div className="mt-[clamp(2rem,4.5vw,3.25rem)] grid gap-x-16 gap-y-8 lg:grid-cols-12">
            <p className="max-w-[16ch] text-statement font-semibold text-balance lg:col-span-6">
              This one helps you find out why.
            </p>

            <div className="max-w-[54ch] lg:col-span-6">
              <p className="text-lede text-[var(--ink-muted)]">
                Your meter records numbers. It cannot tell you whether the walk
                helped, or how sure anyone should be. This works that out from
                your own data.
              </p>

              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
                <Link href={CREATE_ACCOUNT_HREF} className="btn btn-primary text-lede">
                  Create an account
                </Link>
                {/* A real control now, so it is labelled like one. "or leave
                    your email" read as link text borrowed into a button. */}
                <a href="#stay-in-touch" className="btn btn-secondary text-lede">
                  Leave your email
                </a>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ---- 01 ---------------------------------------------------------- */}
      <Fold
        index={1}
        eyebrow="The difference"
        heading={
          <>
            Tracking is a record. Evidence is an answer.
          </>
        }
        aside={
          <Reveal>
            <div className="grid gap-8 sm:grid-cols-2">
              <div className="border-t-2 border-[var(--rule)] pt-5">
                <p className="text-sm text-[var(--ink-faint)]">A tracker says</p>
                <p className="measure mt-3 text-[clamp(1.35rem,1rem+1vw,1.75rem)] text-[var(--ink-muted)]">
                  12.2 mmol/L at 21:40
                </p>
                <p className="mt-4 text-sm leading-relaxed text-[var(--ink-faint)]">
                  True, and you already knew. It happened, it is written down,
                  and nothing follows from it.
                </p>
              </div>

              <div
                className="border-t-2 pt-5"
                style={{ borderColor: 'var(--in-range)' }}
              >
                <p className="text-sm text-[var(--ink-faint)]">This says</p>
                <p className="mt-3 text-[clamp(1.35rem,1rem+1vw,1.75rem)] leading-snug text-[var(--ink)]">
                  Across 156 meals, walking afterwards was associated with a{' '}
                  <span className="measure text-[var(--in-range-text)]">1.1</span>{' '}
                  mmol/L lower rise.
                </p>
                <p className="mt-4 text-sm leading-relaxed text-[var(--ink-faint)]">
                  Testable. And below it, in full, everything that comparison
                  does not account for.
                </p>
              </div>
            </div>
          </Reveal>
        }
      >
        <p>
          A number on its own has nowhere to go. The same number set against
          every other meal you have logged, with the walks marked, starts to be
          worth something.
        </p>
      </Fold>

      {/* ---- 02 ---------------------------------------------------------- */}
      <Fold
        index={2}
        eyebrow="One timeline"
        heading="Everything in one place, and where each line came from."
        aside={
          <Reveal>
            <TimelineExcerpt />
          </Reveal>
        }
      >
        <p>
          Glucose, meals, medication, movement and sleep on a single stream, in
          the order they happened.
        </p>
        <p>
          Every line says where it came from. A filled mark is something we
          measured. A hollow one is something we estimated, and it says how
          confident that estimate is. You should never have to guess which is
          which.
        </p>
      </Fold>

      {/* ---- 03: the centre of gravity ----------------------------------- */}
      <Fold
        index={3}
        eyebrow="A finding"
        heading="Every answer arrives with its own limits attached."
        aside={
          <Reveal>
            <Finding />
          </Reveal>
        }
      >
        <p>
          Findings come from a statistical model, not from a language model. A
          language model may phrase one; it is never allowed to invent one.
        </p>
        <p>
          And when there is not enough data, the answer is that there is not
          enough data, with what to log to change that. That is a real answer,
          so we show it rather than filling the space with something friendlier.
        </p>
      </Fold>

      {/* ---- 04 ---------------------------------------------------------- */}
      <Fold
        index={4}
        eyebrow="Testing it"
        heading="Turn a hunch into something you can actually settle."
        aside={
          <Reveal>
            <div className="surface-raised p-[clamp(1.5rem,3vw,2.5rem)]">
              {/* This one carried a "Being built" label until the loop closed
                  around it. Proposing, starting and measuring all exist now,
                  and the figures below are the seeded scenario's own: -1.3 is
                  the walk effect the demo data encodes and the engine
                  recovers. The label came off when the claim became true,
                  which is the only reason it should ever come off. */}
              <p className="text-sm text-[var(--ink-faint)]">Proposed trial</p>
              <p className="mt-4 text-[clamp(1.25rem,1rem+0.9vw,1.6rem)] leading-snug">
                The same breakfast for six days. Walk after three of them,
                chosen at random.
              </p>

              <dl className="mt-8 space-y-4 border-t border-[var(--rule)] pt-6 text-sm">
                <div className="flex justify-between gap-6">
                  <dt className="text-[var(--ink-faint)]">Predicted difference</dt>
                  <dd className="measure text-[var(--in-range-text)]">-1.3 mmol/L</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-[var(--ink-faint)]">Recorded before it starts</dt>
                  <dd className="text-[var(--ink-muted)]">Yes, permanently</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-[var(--ink-faint)]">Clinician sign-off</dt>
                  <dd className="text-[var(--ink-muted)]">Not required</dd>
                </div>
                <div className="flex justify-between gap-6">
                  <dt className="text-[var(--ink-faint)]">Scored against</dt>
                  <dd className="text-[var(--ink-muted)]">The number above</dd>
                </div>
              </dl>
            </div>
          </Reveal>
        }
      >
        <p>
          The prediction is written down before the trial begins, in the same
          moment it starts, and cannot be edited afterwards. When the six days
          are up, you record what happened and it is scored against that
          number.
        </p>
        <p>
          Neither side of the comparison can be revised once written. That is
          not a promise about how we behave — the database refuses the edit,
          and refuses to let a trial start without an expectation or finish
          without a measurement.
        </p>
        <p>
          Over time that produces something unusual: a record of how often this
          system was right about you specifically.
        </p>
      </Fold>

      {/* ---- 05 ---------------------------------------------------------- */}
      <Fold
        index={5}
        eyebrow="Your appointment"
        heading="Ten minutes is not enough time to explain ninety days."
        aside={
          <Reveal>
            <ClinicianBrief />
          </Reveal>
        }
      >
        <p>
          You can bring one page instead of a year of screenshots: what changed,
          what you tried, what the evidence actually supports, and the questions
          worth asking.
        </p>
        <p>
          It is built to the standards clinical systems already use, so it stays
          useful when you change clinic, device, or country.
        </p>
      </Fold>

      {/* ---- 06 ---------------------------------------------------------- */}
      <Fold
        index={6}
        eyebrow="Who it is for"
        heading="Every kind of diabetes. Not every kind of answer, yet."
        aside={
          <Reveal>
            <CareCoverage />
          </Reveal>
        }
      >
        <p>
          Type 1, Type 2 with or without insulin, gestational, prediabetes, or a
          form your clinician has classified some other way — the record is
          built for all of it. One timeline, your meter or CGM, meals,
          medication, activity and labs, the safety rules, and the summary you
          bring to an appointment.
        </p>
        <p>
          Findings are narrower. The patterns are found by models built on Type
          2 physiology, and they are offered for Type 2 and prediabetes only.
          For everything else Wellovue keeps your record and says so, rather
          than running the wrong model over your data and handing you a
          confident answer you would have no way to check.
        </p>
        <p>
          That is a limit we would rather state than hide. The panel is
          generated from the same rule the product uses, so it cannot say
          something the software does not do.
        </p>
      </Fold>

      {/* ---- 07 ---------------------------------------------------------- */}
      <Fold
        index={7}
        eyebrow="Boundaries"
        heading="What this will never do."
        aside={
          <Reveal>
            <Boundaries />
          </Reveal>
        }
      >
        <p>
          This helps you understand patterns and prepare for a conversation with
          your clinician. It is not a clinician, and it does not pretend to be.
        </p>
        <p>
          These limits are enforced in the system itself, not promised in the
          copy. An experiment marked as needing review cannot be started without
          it.
        </p>
      </Fold>

      {/* ---- Close ------------------------------------------------------- */}
      <section
        id="stay-in-touch"
        className="border-t border-[var(--rule)] bg-[var(--paper-sunk)] py-[clamp(4rem,10vw,9rem)]"
      >
        <div className="mx-auto max-w-6xl px-7 sm:px-8">
          <Reveal>
            <h2 className="max-w-[20ch] text-fold font-semibold text-balance">
              Find out what is actually true for you.
            </h2>
            <p className="mt-6 max-w-[52ch] text-lede text-[var(--ink-muted)]">
              Bring the readings you already have. A CSV from your meter or CGM
              is enough to start.
            </p>

            <div className="mt-10 flex flex-col gap-10 sm:flex-row sm:items-end sm:gap-16">
              <Link
                href="/login"
                className="inline-block shrink-0 bg-[var(--ink)] px-7 py-3.5 text-lede font-medium text-[var(--paper)] transition-opacity hover:opacity-85"
              >
                Create an account
              </Link>
              <EmailCapture />
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingShell>
  );
}
