import { Injectable } from '@nestjs/common';
import {
  expectationFrom,
  findingStrength,
  LAB_WINDOW_DAYS,
  proposalFromFinding,
  type ClinicianPacket,
  type DiscussionPoint,
  type LabSeries,
  type PacketExperiment,
  type ReportPeriod,
  type StructuredFinding,
  type PacketPatient,
} from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EvidenceService } from '../evidence/evidence.service';
import { GlucoseService } from '../glucose/glucose.service';
import { LabsService } from '../labs/labs.service';
import { DiabetesProfileService } from '../diabetes-profile/diabetes-profile.service';

/**
 * The clinician packet, assembled from what the platform already knows.
 *
 * Nothing here computes a new claim. Findings come from the engine through the
 * same service the Evidence screen uses, the glucose figures from the same
 * summary the app shows, the experiments from their own records with the
 * expectations that were frozen before each one ran. This service decides what
 * belongs on one page and what to say about the gaps — and that is all it
 * decides.
 *
 * Assembled on the server rather than in the browser for the reason everything
 * else here is: what a clinician reads about somebody's health data is not a
 * rendering decision. It is also what makes an export possible later without a
 * second implementation drifting from this one.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly evidence: EvidenceService,
    private readonly glucose: GlucoseService,
    private readonly labs: LabsService,
    private readonly profiles: DiabetesProfileService,
  ) {}

  /**
   * Whose record this is, for the top of the printed page.
   *
   * The display name and nothing else, because the display name is all this
   * product holds. No date of birth, no health-service number: the packet
   * cannot identify somebody the way a hospital record does and must not look
   * as though it can, so the page says so rather than leaving a clinician to
   * assume a match has been made.
   */
  private async patientFor(userId: string): Promise<PacketPatient> {
    const row = await this.db.queryOne<{ display_name: string | null }>(
      'select display_name from identity.users where id = $1',
      [userId],
    );
    return { displayName: row?.display_name ?? null };
  }

  async clinicianPacket(userId: string, days: ReportPeriod): Promise<ClinicianPacket> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    const [{ capabilities }, patient, patterns, glucose, labResults, experiments] =
      await Promise.all([
        this.profiles.context(userId),
        // Read here rather than taken from the browser, for the same reason
        // everything else in this packet is: the identity on a document
        // handed to a clinician has to come from the same request as the data
        // it identifies, or the two can disagree about whose record this is.
        this.patientFor(userId),
        // Through the evidence service, so the care-mode gate that decides
        // whether this record may be analysed at all applies here too. A
        // report endpoint that reached the engine directly would be a second
        // door past that gate.
        this.evidence.findings(userId, { from, to }),
        this.glucose.summary(userId, from, to),
        // Deliberately not the packet's window. See LAB_WINDOW_DAYS: a
        // ninety-day period holds one HbA1c, and one point is not a trend.
        this.labs.list(userId, {
          from: new Date(to.getTime() - LAB_WINDOW_DAYS * 24 * 60 * 60 * 1000),
          to,
          testName: undefined,
        }),
        this.experimentsFor(userId, from, to),
      ]);

    const available = capabilities.evidenceEnabled;
    const findings = available ? patterns.findings : [];

    const packet: ClinicianPacket = {
      patient,
      period: { from, to, days },
      generatedAt: new Date(),
      careMode: capabilities.careMode,
      evidence: {
        available,
        // The gate's own sentence when there are no findings to show, rather
        // than an empty list a reader would take for "nothing was found".
        reason: available ? null : capabilities.unsupportedReason,
        modelVersion: available ? patterns.modelVersion : null,
        findings,
      },
      glucose,
      labs: { windowDays: LAB_WINDOW_DAYS, series: seriesFrom(labResults) },
      experiments,
      discussion: discussionFrom(findings, experiments),
      limitations: limitationsFrom(findings),
    };

    // A packet is a read of the whole record, which is exactly the kind of
    // access the trail exists to record. Best effort is not used here: this
    // read is not irreversible, so a failed audit write should fail the
    // request rather than leave an unrecorded sweep of somebody's data.
    await this.audit.record({
      actorUserId: userId,
      subjectUserId: userId,
      action: 'report.clinician_packet',
      resourceType: 'report',
      metadata: {
        days,
        findingCount: findings.length,
        experimentCount: experiments.length,
      },
    });

    return packet;
  }

  /**
   * Experiments that overlap the period, with what was expected and what came
   * of each.
   *
   * Drafts and refusals are left out. A packet is a record of what was done,
   * and a proposal nobody started says nothing about the person in front of
   * the clinician — while a refused one would put an experiment the product
   * declined in front of a professional as though it were part of their care.
   */
  private async experimentsFor(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<PacketExperiment[]> {
    const rows = await this.db.query<ExperimentJoin>(
      `select e.id, e.title, e.question, e.status, e.safety_status,
              e.started_at, e.ended_at,
              p.prediction, p.made_at, p.confidence, m.version,
              o.outcome, o.error_summary
         from experiments.experiments e
         left join ai.predictions p on p.experiment_id = e.id
         left join ai.model_versions m on m.id = p.model_version_id
         left join ai.prediction_outcomes o on o.prediction_id = p.id
        where e.user_id = $1
          and e.status in ('active', 'completed')
          -- Overlapping the window rather than starting inside it: a trial
          -- that began before the period and finished during it is part of
          -- what happened during the period.
          and coalesce(e.started_at, e.created_at) <= $3
          and coalesce(e.ended_at, now()) >= $2
        order by coalesce(e.ended_at, e.started_at, e.created_at) desc`,
      [userId, from, to],
    );

    return rows.map((row) => {
      const expectation = row.prediction ? expectationFrom({ prediction: row.prediction }) : null;
      const summary = row.error_summary;

      return {
        id: row.id,
        title: row.title,
        question: row.question,
        status: row.status,
        safetyStatus: row.safety_status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        modelVersion: row.version ?? null,
        predictedAt: row.made_at,
        predicted: expectation?.expectedEffect ?? summary?.expectedEffect ?? null,
        observed: row.outcome?.observedEffect ?? null,
        error: summary?.error ?? null,
        unit: expectation?.unit ?? null,
        confidence: row.confidence === null ? null : Number(row.confidence),
        notes: row.outcome?.notes ?? null,
      };
    });
  }
}

interface ExperimentJoin {
  id: string;
  title: string;
  question: string;
  status: PacketExperiment['status'];
  safety_status: PacketExperiment['safetyStatus'];
  started_at: Date | null;
  ended_at: Date | null;
  prediction: Record<string, unknown> | null;
  made_at: Date | null;
  confidence: string | null;
  version: string | null;
  outcome: { observedEffect: number; notes: string | null } | null;
  error_summary: { expectedEffect: number | null; error: number | null } | null;
}

/**
 * Lab results grouped into one series per test.
 *
 * Grouped case-insensitively, because a lab import writes whatever the source
 * called the test: the seeder writes `HbA1c` and the contract's enum says
 * `hba1c`, and an exact match once told a record holding eight results that it
 * had none.
 *
 * A test recorded in more than one unit is shown without a change. HbA1c comes
 * in `%` and in `mmol/mol`, which differ by an order of magnitude, so
 * subtracting across them would produce a confident number that means nothing.
 */
function seriesFrom(
  results: { testName: string; unit: string | null; valueNumeric: number | null; collectedAt: Date }[],
): LabSeries[] {
  const groups = new Map<string, typeof results>();

  for (const result of results) {
    if (result.valueNumeric === null) continue; // A text result has no trend.
    const key = result.testName.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.values()].map((group) => {
    // Oldest first: a series reads left to right, and the change is the last
    // one minus the first.
    const points = [...group].sort(
      (a, b) => a.collectedAt.getTime() - b.collectedAt.getTime(),
    );
    const units = new Set(points.map((p) => p.unit ?? 'unrecorded'));
    const trendable = units.size === 1 && points.length > 1;

    const first = points[0].valueNumeric as number;
    const last = points[points.length - 1].valueNumeric as number;

    return {
      // The name as it was most recently written, not the lowercased key.
      testName: points[points.length - 1].testName,
      unit: units.size === 1 ? (points[points.length - 1].unit ?? null) : null,
      points: points.map((p) => ({
        collectedAt: p.collectedAt,
        value: p.valueNumeric as number,
      })),
      latest: last,
      change: trendable ? round(last - first, 2) : null,
      trendable,
      notTrendableReason:
        units.size > 1
          ? `Recorded in more than one unit (${[...units].join(', ')}), which cannot be compared`
          : points.length < 2
            ? 'Only one measurement in this period'
            : null,
    };
  });
}

/**
 * What to raise in the appointment.
 *
 * Two sources, both structured, neither composed:
 *
 *   - a finding the model itself flagged for professional review, carrying its
 *     own summary and, where the shared proposal catalogue already holds one,
 *     its own question;
 *   - an experiment whose result went the *other way* from its prediction.
 *
 * Direction, not magnitude, and that is a deliberate limit. Any threshold on
 * "how far off is worth mentioning" would be a number invented here and then
 * quoted in a consulting room as though it meant something. A sign that
 * disagrees needs no cutoff: the platform expected a fall and there was a rise,
 * or the reverse, and that is a fact about the trial rather than a judgement
 * about it.
 */
function discussionFrom(
  findings: StructuredFinding[],
  experiments: PacketExperiment[],
): DiscussionPoint[] {
  const points: DiscussionPoint[] = [];

  for (const finding of findings) {
    if (!finding.clinicianReviewRecommended) continue;
    points.push({
      kind: 'finding_flagged',
      statement: finding.summary,
      because: `The model flagged this for a professional to look at (${findingStrength(finding)} evidence, n=${finding.sampleCount}).`,
      // Only if the catalogue already holds one. An interrogative invented at
      // render time would be the product putting words in somebody's mouth in
      // front of their doctor.
      question: proposalFromFinding(finding)?.question ?? null,
      findingType: finding.findingType,
      experimentId: null,
    });
  }

  for (const experiment of experiments) {
    const { predicted, observed } = experiment;
    if (predicted === null || observed === null) continue;
    if (predicted === 0 || observed === 0) continue;
    if (Math.sign(predicted) === Math.sign(observed)) continue;

    points.push({
      kind: 'prediction_direction_missed',
      statement: `${experiment.title}: predicted ${format(predicted)}, measured ${format(observed)}${experiment.unit ? ` (${experiment.unit})` : ''}.`,
      because:
        'The result went the opposite way from the expectation recorded before the trial began.',
      question: experiment.question,
      findingType: null,
      experimentId: experiment.id,
    });
  }

  return points;
}

/**
 * Every distinct limitation the findings carried, in one place.
 *
 * Deduplicated because the same caveat legitimately attaches to several
 * findings — "sleep data was not included" is true of most of them — and a
 * list that repeated it four times would read as four separate problems.
 */
function limitationsFrom(findings: StructuredFinding[]): string[] {
  return [...new Set(findings.flatMap((f) => f.limitations))];
}

function format(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
