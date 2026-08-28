import { z } from 'zod';
import { uuidSchema } from './common';
import { careModeSchema } from './diabetes';
import { glucoseSummarySchema } from './glucose';
import { safetyStatusSchema, experimentStatusSchema } from './experiments';
import { structuredFindingSchema } from './insights';

/**
 * The clinician packet: thirty or ninety days on one readable page.
 *
 * PRODUCT.md puts the clinician second — never the primary voice on the
 * screen, but present enough that the person can see this produces something a
 * professional will take seriously in a ten-minute appointment. That is the
 * whole design constraint. A packet that needed reading twice would be worse
 * than no packet, because it would waste the appointment it was meant to save.
 *
 * Assembled on the server, like everything else here that decides what is said
 * about somebody's health data. The browser asks for a period; the server
 * decides what goes in, what is trendable, and what is raised for discussion.
 */

/** Only two, and deliberately so. See `reportPeriodSchema`. */
export const REPORT_PERIODS = [30, 90] as const;

/**
 * How far back lab results are read, whichever period the packet covers.
 *
 * Two years, the same window `labListQuerySchema` defaults to. Quarterly
 * measurements need it: four HbA1c values is a trend, and the two a ninety-day
 * window would hold is a pair of numbers.
 */
export const LAB_WINDOW_DAYS = 730;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/**
 * Thirty days or ninety, and nothing in between.
 *
 * An arbitrary window would let the period be chosen after the answer is seen,
 * which is the same failure as an editable prediction wearing different
 * clothes: a fortnight that reads well is one slider away from a quarter that
 * does not. Two fixed windows, both named on the page.
 */
export const reportPeriodSchema = z.coerce
  .number()
  .int()
  .refine((v): v is ReportPeriod => (REPORT_PERIODS as readonly number[]).includes(v), {
    message: 'A packet covers 30 or 90 days',
  });

export const clinicianPacketQuerySchema = z
  .object({ days: reportPeriodSchema.optional() })
  .transform((v) => ({ days: v.days ?? 90 }));
export type ClinicianPacketQuery = z.infer<typeof clinicianPacketQuerySchema>;

/**
 * One lab test over the period.
 *
 * `trendable` is false when the same test arrives in more than one unit, which
 * happens for real: HbA1c is reported in `%` and in `mmol/mol`, and the two
 * differ by an order of magnitude. A change computed across both would be
 * arithmetic on incompatible numbers, so the series is shown and the change is
 * withheld, with `notTrendableReason` saying why. The engine refuses the same
 * comparison for the same reason.
 */
export const labSeriesSchema = z.object({
  testName: z.string(),
  unit: z.string().nullable(),
  points: z.array(
    z.object({ collectedAt: z.coerce.date(), value: z.number() }),
  ),
  latest: z.number().nullable(),
  /** Latest minus earliest, signed. Null when the series is not trendable. */
  change: z.number().nullable(),
  trendable: z.boolean(),
  notTrendableReason: z.string().nullable(),
});
export type LabSeries = z.infer<typeof labSeriesSchema>;

/**
 * An experiment as it appears in the packet.
 *
 * Predicted and observed both, or neither. A result without the expectation it
 * was scored against is a number with no claim attached, and the expectation
 * without the result is a promise — the packet is worth reading precisely
 * because it carries both, and because neither could be edited after the fact.
 */
export const packetExperimentSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  question: z.string(),
  status: experimentStatusSchema,
  safetyStatus: safetyStatusSchema,
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  /** The engine build that committed to the expectation, and when it did. */
  modelVersion: z.string().nullable(),
  predictedAt: z.coerce.date().nullable(),
  predicted: z.number().nullable(),
  observed: z.number().nullable(),
  /** Signed: observed minus predicted. */
  error: z.number().nullable(),
  unit: z.string().nullable(),
  confidence: z.number().nullable(),
  notes: z.string().nullable(),
});
export type PacketExperiment = z.infer<typeof packetExperimentSchema>;

/**
 * Something raised for the appointment.
 *
 * Every item here is derived from a structured signal — a finding the model
 * flagged, or an experiment whose result went the other way from its
 * prediction. Nothing on this list is composed, and no language model writes
 * any of it, for the same reason no finding comes from one: a plausible
 * sentence a clinician reads as a claim is the most expensive thing this
 * product could get wrong.
 *
 * `question` is present only when the shared proposal catalogue already holds
 * one for that finding. An interrogative invented at render time would be the
 * product putting words in somebody's mouth in front of their doctor.
 */
export const discussionPointSchema = z.object({
  kind: z.enum(['finding_flagged', 'prediction_direction_missed']),
  /** The model's own words about what was seen. */
  statement: z.string(),
  /** Why this is on the list, in the packet's words rather than the model's. */
  because: z.string(),
  question: z.string().nullable(),
  findingType: z.string().nullable(),
  experimentId: uuidSchema.nullable(),
});
export type DiscussionPoint = z.infer<typeof discussionPointSchema>;

/**
 * Whose record this is.
 *
 * A printed packet is handed across a desk and put in a pile. Without a name
 * on it, page three is a page of somebody's glucose that nobody can attribute
 * — which is worse than useless in a clinic, because it looks like data.
 *
 * The name is all this holds, because the name is all the product holds. There
 * is no date of birth and no health-service number here, so the packet cannot
 * pretend to identify somebody the way a hospital record does, and it says so
 * on the page rather than leaving a clinician to assume it has been matched.
 *
 * Assembled on the server with the rest of the packet, so the identity and the
 * data come from one request and cannot disagree about whose they are.
 */
export const packetPatientSchema = z.object({
  displayName: z.string().nullable(),
});
export type PacketPatient = z.infer<typeof packetPatientSchema>;

export const clinicianPacketSchema = z.object({
  patient: packetPatientSchema,
  period: z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    days: reportPeriodSchema,
  }),
  generatedAt: z.coerce.date(),
  careMode: careModeSchema,
  /**
   * Findings, or the reason there are none.
   *
   * `available` is false for a care mode with no reviewed detectors, and the
   * packet says so in place of the section rather than printing an empty
   * heading. A clinician reading a blank findings list would reasonably
   * conclude nothing was found, which is a different claim from "this was
   * never analysed".
   */
  evidence: z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
    modelVersion: z.string().nullable(),
    findings: z.array(structuredFindingSchema),
  }),
  glucose: glucoseSummarySchema,
  /**
   * Labs over their own window, which is longer than the packet's.
   *
   * A lab is not a daily measurement. HbA1c is drawn every three months or so,
   * meaning a ninety-day packet would carry exactly one and a thirty-day
   * packet often none — and a single point is the shape of data a clinician
   * least needs a summary for. The window that makes an HbA1c trend a trend
   * rather than two points is the one `labListQuerySchema` already settled on,
   * and it is stated on the page rather than quietly differing from the
   * heading above it.
   */
  labs: z.object({
    windowDays: z.number().int(),
    series: z.array(labSeriesSchema),
  }),
  experiments: z.array(packetExperimentSchema),
  discussion: z.array(discussionPointSchema),
  /**
   * What the whole packet does not account for: every distinct limitation the
   * findings carried, deduplicated, in one place.
   *
   * Deliberately not a footnote. PRODUCT.md's position is that showing the
   * limits is the trust signal rather than a disclaimer to bury, so the page
   * puts this section ahead of what it raises for discussion: whatever the
   * packet asks a clinician to consider should be read in light of what it
   * could not account for, not before it.
   */
  limitations: z.array(z.string()),
});
export type ClinicianPacket = z.infer<typeof clinicianPacketSchema>;

/**
 * What the browser prints in its own page header, on every page.
 *
 * The one piece of repeated per-page identification that actually works
 * everywhere. CSS cannot reliably repeat a block on every printed page —
 * `position: fixed` behaves differently across browsers and versions — but
 * every browser prints the document title and a page number in its own margin,
 * and every one of them repeats it. So the title is made to carry what a
 * clinician needs on page three: whose record this is, and over what period.
 *
 * Shared rather than written on the page for the same reason the packet's
 * labels are: this string is the identification on a document somebody is
 * handed, and it must not drift from what the page itself says.
 */
export function packetDocumentTitle(
  packet: Pick<ClinicianPacket, 'patient' | 'period'>,
  formatDate: (date: Date) => string,
): string {
  const who = packet.patient.displayName ?? 'Wellovue user';
  return `${who} — Wellovue summary, ${formatDate(packet.period.from)} to ${formatDate(
    packet.period.to,
  )}`;
}
