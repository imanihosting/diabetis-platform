import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  experimentDecision,
  type CreateExperimentInput,
  type Experiment,
  type Prediction,
  type ExperimentDecision,
  type ExperimentStatus,
  type SafetyStatus,
} from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DiabetesProfileService } from '../diabetes-profile/diabetes-profile.service';
import { PredictionsService } from '../predictions/predictions.service';

export interface CreatedExperiment {
  experiment: Experiment;
  decision: ExperimentDecision;
}

export interface StartedExperiment {
  experiment: Experiment;
  prediction: Prediction;
}

/**
 * Self-experiments, and the safety decision attached to each one.
 *
 * This is the first caller of `classifyTemplate`. Until now the classifier was
 * a correct primitive nothing invoked, and the database's check constraints
 * were the only thing actually enforcing the rules. Both still hold: the API
 * decides, and the constraints refuse the decision independently if it is
 * wrong. Two lines, neither trusting the other.
 *
 * Nothing about the safety outcome comes from the request. The browser sends a
 * template and a question; the server derives the care mode, the flags in
 * force, the status, and whether review is required. A request could otherwise
 * send `clinicianReviewRequired: false` alongside a gated template and turn a
 * safety rule into a constraint violation returned as a 500.
 */
@Injectable()
export class ExperimentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly profiles: DiabetesProfileService,
    private readonly predictions: PredictionsService,
  ) {}

  async create(
    userId: string,
    input: CreateExperimentInput,
  ): Promise<CreatedExperiment> {
    // The resolved truth, from the server's own record. `activeFlags` is
    // already the latest row per flag, so the classifier receives flags in
    // force rather than an append-only history it would have to reconstruct.
    const { profile, activeFlags } = await this.profiles.context(userId);

    const decision = experimentDecision(input.template, {
      careMode: profile.careMode,
      safetyFlags: activeFlags,
    });

    const experiment = await this.db.transaction(async (client) => {
      const { rows } = await client.query<ExperimentRow>(
        `insert into experiments.experiments
           (user_id, hypothesis_id, template, title, question, protocol,
            safety_status, clinician_review_required, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning *`,
        [
          userId,
          input.hypothesisId ?? null,
          // Stored, so the row records what the safety decision was about and
          // not only what it was. Anything downstream that needs to know what
          // this experiment tests reads it here rather than guessing from the
          // title.
          input.template,
          input.title,
          input.question,
          JSON.stringify(input.protocol),
          decision.status,
          decision.clinicianReviewRequired,
          decision.experimentStatus,
        ],
      );
      const row = rows[0];

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'experiment.create',
          resourceType: 'experiment',
          resourceId: row.id,
          // What was asked and how it was answered. A refusal is worth as much
          // in the trail as a permission, and arguably more.
          metadata: {
            template: input.template,
            safetyStatus: decision.status,
            careMode: profile.careMode,
          },
        },
        client,
      );

      return toExperiment(row);
    });

    return {
      experiment,
      decision: {
        status: decision.status,
        reason: decision.reason,
        canStart: decision.canStart,
      },
    };
  }

  /**
   * Starts an experiment, and records what is expected of it first.
   *
   * Both writes are one transaction, and the order inside it is the point. The
   * platform's claim is that the prediction was written down before the trial
   * began; if these were two calls, the failure mode is an experiment running
   * with no record of what was expected, which is exactly the state that makes
   * every accuracy figure downstream a lie.
   *
   * The database enforces the same thing independently. Migration 0018 adds a
   * trigger refusing any transition to `active` without a prediction attached
   * to that experiment, so a future caller that gets the order wrong is
   * stopped rather than trusted.
   */
  async start(userId: string, experimentId: string): Promise<StartedExperiment> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<ExperimentRow>(
        `select * from experiments.experiments
          where id = $1 and user_id = $2
          for update`,
        [experimentId, userId],
      );
      const existing = rows[0];
      if (!existing) throw new NotFoundException('No such experiment');

      if (existing.safety_status === 'blocked') {
        throw new BadRequestException(
          'This experiment is blocked and will never run. Nothing about starting it is a matter of timing.',
        );
      }

      if (existing.safety_status === 'clinician_gated') {
        // Clinician review does not exist yet, so there is no way for one of
        // these to become startable. Saying "not yet reviewed" would imply a
        // queue somebody is working through.
        throw new BadRequestException(
          'This experiment needs a clinician to agree to it first, and Wellovue has no way to record that agreement yet. It stays waiting.',
        );
      }

      if (existing.status !== 'draft') {
        throw new ConflictException(
          `This experiment is already ${existing.status}, so it cannot be started.`,
        );
      }

      // First, and in this transaction. Throwing here rolls back everything,
      // which is the behaviour that matters: an experiment must not be able to
      // start when the prediction could not be written.
      const prediction = await this.predictions.createWithin(
        client,
        userId,
        experimentId,
        null,
      );

      const started = await client.query<ExperimentRow>(
        `update experiments.experiments
            set status = 'active', started_at = now()
          where id = $1
          returning *`,
        [experimentId],
      );

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'experiment.start',
          resourceType: 'experiment',
          resourceId: experimentId,
          metadata: { predictionId: prediction.id, template: existing.template },
        },
        client,
      );

      return { experiment: toExperiment(started.rows[0]), prediction };
    });
  }

  async list(userId: string): Promise<Experiment[]> {
    const rows = await this.db.query<ExperimentRow>(
      `select * from experiments.experiments
        where user_id = $1
        order by created_at desc`,
      [userId],
    );
    return rows.map(toExperiment);
  }
}

interface ExperimentRow {
  id: string;
  user_id: string;
  hypothesis_id: string | null;
  template: string | null;
  title: string;
  question: string;
  protocol: Record<string, unknown>;
  safety_status: SafetyStatus;
  clinician_review_required: boolean;
  status: ExperimentStatus;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
}

function toExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    userId: row.user_id,
    hypothesisId: row.hypothesis_id,
    template: row.template,
    title: row.title,
    question: row.question,
    protocol: row.protocol,
    safetyStatus: row.safety_status,
    clinicianReviewRequired: row.clinician_review_required,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}
