'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import {
  REPORT_PERIODS,
  careModeLabel,
  findingPresentation,
  EVIDENCE_BREAKDOWN_LABELS,
  dataQualityHeadline,
  dataQualityMeasurements,
  evidenceBreakdown,
  packetDocumentTitle,
  postMealCaveat,
  postMealMeasurements,
  type ClinicianPacket,
  type CompetingExplanation,
  type DataQuality,
  type DiscussionPoint,
  type GroupMeasure,
  type LabSeries,
  type PacketExperiment,
  type ReportPeriod,
  type StructuredFinding,
} from '@wellovue/types';
import { AppShell } from '@/components/AppShell';
import { EvidenceBadge } from '@/components/EvidenceBadge';
import { GlucoseSummaryPanel } from '@/components/GlucoseSummaryPanel';
import { useClinicianPacket } from '@/hooks/useClinicianPacket';
import { useCurrentUser } from '@/hooks/useAuth';

/**
 * The clinician packet: thirty or ninety days on one page.
 *
 * PRODUCT.md puts the clinician second — never the primary voice in this
 * product, but present enough that a person can see their record produces
 * something a professional will take seriously. A ten-minute appointment
 * cannot absorb hundreds of charts, so the constraint here is not "show
 * everything known" but "survive one reading by somebody who is short of
 * time".
 *
 * Three things follow from that.
 *
 * The order is a clinician's, not the app's: the period, then the numbers they
 * would ask for first, then what was actually tested, then what the model
 * found, then the limits, and only then what is being raised. Anything the
 * packet asks them to consider is read after what it could not account for.
 *
 * Nothing on this page is composed here. Findings are the engine's own words,
 * limitations are its own list, and the discussion points are assembled on the
 * server from structured signals. The page decides where things sit.
 *
 * It is built to survive a printer. PRODUCT.md requires target bands and
 * evidence strength to stay legible in greyscale, because these get printed
 * and handed over, so every colour here is paired with a word and the app
 * chrome drops out under `print:`.
 */
export default function ReportPage() {
  const user = useCurrentUser();
  const [days, setDays] = useState<ReportPeriod>(90);
  const packet = useClinicianPacket(days);

  if (user.isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-ink-faint">Loading…</p>
      </AppShell>
    );
  }

  if (user.isError || !user.data) {
    return (
      <AppShell>
        <div className="surface-sunk px-6 py-12 text-center">
          <p className="text-ink">You are not signed in.</p>
          <Link
            href="/login"
            className="mt-3 inline-block text-sm text-ink underline underline-offset-4"
          >
            Sign in to see your summary
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-ink">
            Summary for an appointment
          </h1>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-muted print:hidden">
            Everything on this page comes from your own records. It is for you
            to bring, and for a clinician to read in a minute.
          </p>
          {packet.data && <PrintSource packet={packet.data} />}
        </div>

        {/* Two windows, both named. An arbitrary range would let the period be
            chosen after the answer is seen. */}
        <div className="flex gap-1 print:hidden" role="group" aria-label="Period">
          {REPORT_PERIODS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              aria-pressed={days === option}
              className={
                days === option
                  ? 'border border-ink px-3 py-1.5 text-sm text-ink'
                  : 'border border-rule px-3 py-1.5 text-sm text-ink-faint hover:text-ink-muted'
              }
            >
              {option} days
            </button>
          ))}
        </div>
      </div>

      {packet.isPending && (
        <p className="mt-8 text-sm text-ink-faint" role="status">
          Reading {days} days…
        </p>
      )}

      {packet.isError && (
        <p className="mt-8 text-sm text-zone-belowText" role="alert">
          That could not be assembled. Try again in a moment.
        </p>
      )}

      {packet.data && <Packet packet={packet.data} />}
    </AppShell>
  );
}

function Packet({ packet }: { packet: ClinicianPacket }) {
  /**
   * The browser prints this in its own page header, on every page.
   *
   * The only per-page identification that works everywhere. CSS cannot
   * reliably repeat a block across printed pages, and every browser already
   * prints the document title and a page number in the margin — so the title
   * is made to carry what somebody holding page three needs: whose record this
   * is, and over what period.
   *
   * Restored on the way out. The title belongs to the packet, not to the tab,
   * and leaving a patient's name in it after navigating away would put it in
   * the browser history of a shared computer.
   */
  useEffect(() => {
    const previous = document.title;
    document.title = packetDocumentTitle(packet, formatDate);
    return () => {
      document.title = previous;
    };
  }, [packet]);

  return (
    <article className="mt-8">
      <RunningIdentification packet={packet} />
      <Provenance packet={packet} />

      <Section title="Glucose">
        <GlucoseSummaryPanel summary={packet.glucose} />
      </Section>

      {packet.labs.series.length > 0 && (
        <Section title="Lab and body measurements">
          {/* The window differs from the packet's, and says so. A lab is not a
              daily measurement: quarterly HbA1c over ninety days is one point,
              and one point is not a trend. */}
          <p className="mb-4 max-w-prose text-sm leading-relaxed text-ink-muted">
            Over the last {Math.round(packet.labs.windowDays / 365)} years, not
            the {packet.period.days} days above — a lab is drawn every few
            months, and a single value is not a trend.
          </p>
          <ul className="space-y-5">
            {packet.labs.series.map((series) => (
              <li key={series.testName}>
                <Lab series={series} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="What was tested">
        {packet.experiments.length === 0 ? (
          <Empty>
            No experiment ran in this period. Nothing here has been tested
            against a prediction, so everything below is observation.
          </Empty>
        ) : (
          <ul className="space-y-5">
            {packet.experiments.map((experiment) => (
              <li key={experiment.id}>
                <Experiment experiment={experiment} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What the model found">
        {packet.evidence.available ? (
          packet.evidence.findings.length === 0 ? (
            <Empty>
              No findings for this period. There was not enough data for the
              detectors to say anything, which is a result rather than an
              absence of one.
            </Empty>
          ) : (
            <ul className="space-y-5">
              {packet.evidence.findings.map((finding) => (
                <li key={finding.findingType}>
                  <Finding finding={finding} />
                </li>
              ))}
            </ul>
          )
        ) : (
          // Never an empty list here. A clinician reading a blank findings
          // section would reasonably take it for "nothing was found", which is
          // a different claim from "this was never analysed".
          <Empty>
            {packet.evidence.reason ??
              'Wellovue does not yet produce findings for this care mode.'}{' '}
            The records above are complete; it is the interpretation that has
            not been built.
          </Empty>
        )}
      </Section>

      {packet.limitations.length > 0 && (
        <Section title="What this does not account for">
          {/* Ahead of the discussion, not after it. Whatever the packet asks a
              clinician to consider should be read in light of what it could
              not see. */}
          <List items={packet.limitations} />
        </Section>
      )}

      <Section title="Raised for discussion">
        {packet.discussion.length === 0 ? (
          <Empty>
            Nothing in this period was flagged for a professional to look at,
            and no experiment went the other way from its prediction.
          </Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {packet.discussion.map((point, index) => (
              <li
                key={`${point.kind}-${point.findingType ?? point.experimentId ?? index}`}
                className="py-4 first:pt-0 last:pb-0"
              >
                <Discussion point={point} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* No care boundary repeated here. The shell already carries it, above
          the footer, on every screen and on the printed page — and a boundary
          stated twice on one sheet reads as boilerplate rather than as the
          thing it is. */}
    </article>
  );
}

/**
 * Where this came from, at the top rather than in small print.
 *
 * A clinician's first question about a document a patient brings is what made
 * it and over what period. Answering that before the content is the difference
 * between a record and a printout.
 */
function Provenance({ packet }: { packet: ClinicianPacket }) {
  return (
    <dl
      data-print="keep"
      className="grid gap-x-8 gap-y-3 surface-raised p-5 sm:grid-cols-2"
    >
      <Fact label="Patient">
        {packet.patient.displayName ?? 'Name not recorded'}
      </Fact>
      <Fact label="Period">
        {formatDate(packet.period.from)} to {formatDate(packet.period.to)} (
        {packet.period.days} days)
      </Fact>
      <Fact label="Prepared">{formatDate(packet.generatedAt)}</Fact>
      <Fact label="Care profile">{careModeLabel(packet.careMode)}</Fact>
      <Fact label="Findings produced by">
        {packet.evidence.modelVersion ?? 'No detector ran for this care profile'}
      </Fact>

      {/* Said on the page rather than left to be assumed. A clinician filing
          this beside a hospital record needs to know it was not matched
          against one: the product holds a name and no other identifier, so
          this identifies an account and not a patient. */}
      <p className="text-xs leading-relaxed text-ink-faint sm:col-span-2">
        Prepared by the person named above from their own records. Wellovue
        holds no date of birth or health-service number, so this identifies an
        account rather than a verified patient record.
      </p>
    </dl>
  );
}

/**
 * Whose record this is, on every printed sheet.
 *
 * A packet is read out of order and put down in pieces. Page four on its own
 * is a page of somebody's glucose that nobody can attribute, which in a clinic
 * is worse than no page at all.
 *
 * The browser prints the document title in its own header and that carries the
 * same thing — but a reader can turn headers off, and some print paths omit
 * them. This is the copy that does not depend on that choice.
 */
function RunningIdentification({ packet }: { packet: ClinicianPacket }) {
  return (
    <div data-print="running" className="hidden">
      {packet.patient.displayName ?? 'Name not recorded'} · Wellovue summary ·{' '}
      {formatDate(packet.period.from)} to {formatDate(packet.period.to)}
    </div>
  );
}

/**
 * Where the sheet came from and whose it is, for paper only.
 *
 * On screen the app's chrome carries the wordmark and the page has its own
 * heading. On paper the chrome is gone, so a printed sheet would open on
 * "Summary for an appointment" with nothing saying which product produced it.
 *
 * A line rather than a second heading: the page already has one, and printing
 * two would have a clinician reading the same title twice before reaching any
 * data.
 */
function PrintSource({ packet }: { packet: ClinicianPacket }) {
  return (
    <p data-print="only" className="mt-1 hidden text-sm text-ink-muted">
      Wellovue · {packet.patient.displayName ?? 'Name not recorded'} ·{' '}
      {formatDate(packet.period.from)} to {formatDate(packet.period.to)}
    </p>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Lab({ series }: { series: LabSeries }) {
  return (
    <div data-print="keep" className="surface-raised p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm text-ink">{series.testName}</h3>
        <p className="text-sm text-ink">
          <span className="measure font-medium">{series.latest}</span>
          {series.unit && (
            <span className="ml-2 text-xs text-ink-faint">{series.unit}</span>
          )}
        </p>
      </div>

      {series.trendable && series.change !== null ? (
        <p className="mt-2 text-sm text-ink-muted">
          <span className="measure">{signed(series.change)}</span> across{' '}
          {series.points.length} measurements, earliest{' '}
          {formatDate(series.points[0].collectedAt)}.
        </p>
      ) : (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
          {series.notTrendableReason ?? 'No trend shown for this series.'}
          {series.points.length > 1 &&
            ` The ${series.points.length} values are listed below rather than compared.`}
        </p>
      )}

      {!series.trendable && series.points.length > 1 && (
        <ul className="mt-3 space-y-1">
          {series.points.map((point) => (
            <li
              key={point.collectedAt.toString()}
              className="measure text-sm text-ink-muted"
            >
              {point.value} — {formatDate(point.collectedAt)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One experiment, with the expectation recorded before it ran.
 *
 * Predicted and observed in the same ink, as on the experiment's own screen,
 * and for the same reason: colour in this product means glucose against target
 * or evidence strength, and a coloured result would tell a clinician the
 * platform had graded itself.
 */
function Experiment({ experiment }: { experiment: PacketExperiment }) {
  const finished = experiment.observed !== null;

  return (
    <div className="surface-raised p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h3 className="max-w-md text-sm text-ink">{experiment.title}</h3>
        <span className="border border-rule px-2 py-0.5 text-xs text-ink-muted">
          {finished ? 'Finished' : 'Running'}
        </span>
      </div>

      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        {experiment.question}
      </p>

      {experiment.predicted !== null && (
        <dl className="mt-4 grid gap-4 border-t border-rule pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-faint">
              Predicted
            </dt>
            <dd className="mt-1 text-sm text-ink">
              <span className="measure font-medium">{signed(experiment.predicted)}</span>
              {experiment.unit && (
                <span className="ml-2 text-xs text-ink-faint">{experiment.unit}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-faint">
              Observed
            </dt>
            <dd className="mt-1 text-sm text-ink">
              {experiment.observed === null ? (
                <span className="text-ink-muted">Still running</span>
              ) : (
                <>
                  <span className="measure font-medium">
                    {signed(experiment.observed)}
                  </span>
                  {experiment.unit && (
                    <span className="ml-2 text-xs text-ink-faint">{experiment.unit}</span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>
      )}

      {experiment.predictedAt && (
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-ink-faint">
          The prediction was recorded {formatDate(experiment.predictedAt)}
          {experiment.modelVersion && ` by ${experiment.modelVersion}`}, before
          the trial began, and cannot be edited. Neither can the result.
        </p>
      )}

      {experiment.notes && (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink-muted">
          {experiment.notes}
        </p>
      )}
    </div>
  );
}

/** A finding as the engine returned it, limitations included. */
function Finding({ finding }: { finding: StructuredFinding }) {
  return (
    <div className="surface-raised p-6 print:p-4">
      <div data-print="keep" className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-faint">
            {findingPresentation(finding.findingType).lens}
          </p>
          <h3 className="mt-1 text-sm font-medium text-ink">
            {findingPresentation(finding.findingType).title}
          </h3>
          {/* The identifier stays, quietly. A clinician quotes it back and the
              packet keys on it; it is a reference, not a heading. */}
          <p className="measure mt-1 text-xs text-ink-faint">{finding.findingType}</p>
        </div>
        <EvidenceBadge finding={finding} />
      </div>

      <div data-print="keep">
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-ink">
          {finding.summary}
        </p>

        {finding.effectEstimate !== null && (
          <p className="mt-3 text-sm text-ink">
            <span className="measure font-medium">{signed(finding.effectEstimate)}</span>
            {finding.effectUnit && (
              <span className="ml-2 text-xs text-ink-faint">{finding.effectUnit}</span>
            )}
          </p>
        )}
      </div>

      <PostMeal groups={finding.comparison} />

      <Quality finding={finding} />

      <OtherReasons explanations={finding.competingExplanations} />

      {finding.limitations.length > 0 && (
        <div data-print="keep" className="mt-4 border-t border-rule pt-3">
          <h4 className="text-xs uppercase tracking-wide text-ink-faint">
            Does not account for
          </h4>
          <List items={finding.limitations} className="mt-2" />
        </div>
      )}
    </div>
  );
}

/**
 * What else could have produced this pattern, in the packet's shorter form.
 *
 * The evidence page opens each of these to say why it could produce the
 * pattern and what is missing; here they are one line apiece. That is not a
 * space saving. A clinician reading a finding already knows why meal
 * composition confounds a meal comparison — what they need from this page is
 * which confounders this particular record cannot rule out, and a paragraph
 * explaining each one would slow down the reader who needed it least.
 *
 * What is kept is the part they cannot know: whether the missing data is
 * something the person could start recording, or something nothing here can
 * hold. That is the difference between a conversation about logging and a
 * caveat that will still be true next quarter.
 */
function OtherReasons({ explanations }: { explanations: CompetingExplanation[] }) {
  if (explanations.length === 0) return null;

  return (
    <div data-print="keep" className="mt-4 border-t border-rule pt-3">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">
        Other possible reasons
      </h4>

      <ul className="mt-2 space-y-1.5">
        {explanations.map((explanation) => (
          <li
            key={explanation.label}
            className="flex max-w-prose gap-2 text-xs leading-relaxed text-ink-muted"
          >
            <span aria-hidden className="text-ink-faint">
              &#8213;
            </span>
            <span>
              <span className="text-ink">{explanation.label}.</span>{' '}
              {explanation.missing}
              {explanation.capture === null && (
                <span className="text-ink-faint"> (not recorded by Wellovue)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How complete the record behind a finding is.
 *
 * Fully expanded here, unlike the evidence page, where the detail sits behind
 * a disclosure. A clinician deciding how much weight to give a finding is
 * exactly the reader who wants the longest gap and the sampling interval, and
 * this page has to survive being printed — a disclosure on paper is a section
 * that does not exist.
 *
 * Rows come from the same `dataQualityMeasurements()` the evidence page uses.
 */
function Quality({ finding }: { finding: StructuredFinding }) {
  const quality: DataQuality | null = finding.dataQuality;
  if (!quality) return null;

  const breakdown = evidenceBreakdown(finding);

  return (
    <div data-print="keep" className="mt-4 border-t border-rule pt-3">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">
        Record behind this finding
      </h4>

      {/* Both halves of the judgement, because they call for different
          responses. A clinician reading "weak" is owed the difference between
          a relationship that may not be real and one that is real enough but
          watched for a fortnight of a quarter. */}
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-muted">
        {breakdown.note ?? dataQualityHeadline(quality)}
      </p>

      <p className="mt-1 text-xs text-ink-muted">
        <span className="text-ink-faint">{EVIDENCE_BREAKDOWN_LABELS.signal}: </span>
        {breakdown.signal}
        <span className="text-ink-faint">
          {' '}
          · {EVIDENCE_BREAKDOWN_LABELS.coverage}:{' '}
        </span>
        {breakdown.coverage ?? breakdown.signal}
      </p>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {dataQualityMeasurements(quality).map((row) => (
          <Fragment key={row.key}>
            <dt className="text-xs text-ink-faint">{row.label}</dt>
            <dd className="text-xs text-ink">
              <span className={row.measure ? 'measure' : undefined}>{row.value}</span>
              {row.unit && <span className="ml-1 text-ink-faint">{row.unit}</span>}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * The post-meal measurements, for the reader they matter most to.
 *
 * The person sees these on their evidence page; leaving them off the packet
 * would hand their clinician the thinner, older version of the same finding
 * and let the two of them read different documents in the same appointment.
 *
 * Rows and labels come from `postMealMeasurements()` — the same function the
 * evidence page uses, so the two surfaces cannot name a measurement
 * differently. Only the layout is decided here, and it is decided by the
 * printer: a definition list per group rather than the comparison table the
 * screen uses, because this page is laid out in a narrow print column beside
 * the finding's limitations and a table would either scroll or be cut.
 */
function PostMeal({ groups }: { groups: GroupMeasure[] }) {
  const measured = groups.flatMap((group) => {
    const rows = postMealMeasurements(group);
    return rows ? [{ group, rows }] : [];
  });
  if (measured.length === 0) return null;

  return (
    <div className="mt-4 border-t border-rule pt-3">
      <h4 className="text-xs uppercase tracking-wide text-ink-faint">
        Post-meal response
      </h4>

      <div className="mt-2 space-y-3">
        {measured.map(({ group, rows }) => {
          const caveat = postMealCaveat(group);
          return (
            <div key={group.label} className="break-inside-avoid">
              {measured.length > 1 && (
                <p className="text-xs text-ink-muted">{group.label}</p>
              )}
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {rows.map((row) => (
                  <Fragment key={row.key}>
                    <dt className="text-xs text-ink-faint">{row.label}</dt>
                    <dd className="text-xs text-ink">
                      <span className={row.measure ? 'measure' : undefined}>
                        {row.value}
                      </span>
                      {row.unit && (
                        <span className="ml-1 text-ink-faint">{row.unit}</span>
                      )}
                    </dd>
                  </Fragment>
                ))}
              </dl>
              {caveat && (
                <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-ink-faint">
                  {caveat}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One thing worth raising, with why it is on the list.
 *
 * The statement is the model's; the reason it appears is the packet's, and the
 * two are kept visibly apart so a clinician can tell which is which.
 */
function Discussion({ point }: { point: DiscussionPoint }) {
  return (
    <div>
      <p className="max-w-prose text-sm leading-relaxed text-ink">{point.statement}</p>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-faint">
        {point.because}
      </p>
      {point.question && (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
          {point.question}
        </p>
      )}
    </div>
  );
}

/**
 * One band of the packet.
 *
 * Deliberately *not* kept whole on paper. A findings section runs to several
 * pages, and forcing it onto one would push it to the next page and leave the
 * previous one half empty — which over a ninety-day packet costs whole sheets.
 * What must not split is the individual object: a finding, an experiment, a
 * lab series. Those carry `data-print="keep"`; a section carries the rule that
 * its heading stays with whatever follows it.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="border-b border-rule pb-2 text-xs uppercase tracking-wide text-ink-faint">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function List({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-sm leading-relaxed text-ink-muted">
          <span aria-hidden className="text-ink-faint">
            &#8213;
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="surface-sunk max-w-prose px-5 py-4 text-sm leading-relaxed text-ink-muted">
      {children}
    </p>
  );
}

/** Keeps the sign: "1.1" and "-1.1" are different answers. */
function signed(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
