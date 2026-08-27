import { Injectable } from '@nestjs/common';
import {
  experimentDecision,
  type CreateExperimentInput,
  type Experiment,
  type ExperimentDecision,
  type ExperimentStatus,
  type SafetyStatus,
} from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { DiabetesProfileService } from '../diabetes-profile/diabetes-profile.service';

export interface CreatedExperiment {
  experiment: Experiment;
  decision: ExperimentDecision;
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
           (user_id, hypothesis_id, title, question, protocol,
            safety_status, clinician_review_required, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning *`,
        [
          userId,
          input.hypothesisId ?? null,
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
