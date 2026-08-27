import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  proposalFromFinding,
  type AttachOutcomeInput,
  type CreatePredictionInput,
  type PatternResponse,
  type Prediction,
  type PredictionOutcome,
} from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { EvidenceService } from '../evidence/evidence.service';
import { DiabetesProfileService } from '../diabetes-profile/diabetes-profile.service';

/**
 * Predictions, written before an experiment runs and never touched again.
 *
 * `ai.predictions` has a trigger that refuses DELETE outright and permits UPDATE
 * only on `status`. This service is built so that guarantee is never tested in
 * anger: there is no code path here that updates a prediction's content, and no
 * endpoint that could reach one. The trigger is the second line, not the first.
 *
 * Nothing about what was predicted comes from the request. The client names an
 * experiment and, optionally, when it should be judged; everything else — the
 * expected effect, the confidence, the model version, the snapshot of what was
 * known — is derived here from the evidence as it stands at this moment. A
 * platform whose accountability record could be dictated by the thing being
 * held accountable is not keeping one.
 */
@Injectable()
export class PredictionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly evidence: EvidenceService,
    private readonly profiles: DiabetesProfileService,
  ) {}

  async create(userId: string, input: CreatePredictionInput): Promise<Prediction> {
    const experiment = await this.db.queryOne<{
      id: string;
      template: string | null;
      title: string;
      safety_status: string;
    }>(
      `select id, template, title, safety_status
         from experiments.experiments
        where id = $1 and user_id = $2`,
      [input.experimentId, userId],
    );
    if (!experiment) throw new NotFoundException('No such experiment');

    if (!experiment.template) {
      throw new BadRequestException(
        'This experiment predates the template being recorded, so there is nothing to predict about.',
      );
    }
    if (experiment.safety_status === 'blocked') {
      // Nothing the product refuses to run gets a prediction. Writing one would
      // put an immutable expectation about an experiment that can never happen
      // into the accountability record.
      throw new BadRequestException(
        'This experiment is blocked, so it will never run and cannot be predicted.',
      );
    }

    // The evidence as it stands now, which is what makes the prediction a
    // prediction rather than a description. Read through the same service the
    // Evidence screen uses, so the number written down is the number the person
    // was looking at.
    const [{ capabilities }, evidence] = await Promise.all([
      this.profiles.context(userId),
      this.currentEvidence(userId),
    ]);

    const basis = evidence.findings.find(
      (f) => proposalFromFinding(f)?.template === experiment.template,
    );
    if (!basis || basis.effectEstimate === null) {
      throw new BadRequestException(
        'There is no current finding this experiment would settle, so there is nothing to predict. ' +
          'Evidence changes as data arrives; this experiment may have been proposed from a finding that no longer holds.',
      );
    }

    // Taken from the engine's own response rather than restated here. A
    // second copy of the version string in TypeScript would be one more thing
    // that can disagree with the engine, and this is the field that says which
    // model to credit or blame.
    const modelVersionId = await this.resolveModelVersion(evidence.modelVersion);

    const prediction = {
      expectedEffect: basis.effectEstimate,
      unit: basis.effectUnit,
      statement: basis.summary,
      basisFindingType: basis.findingType,
    };

    // Enough to replay the reasoning later without trusting anybody's memory
    // of what the screen said.
    const inputSnapshot = {
      finding: basis,
      careMode: capabilities.careMode,
      safetyTier: capabilities.safetyTier,
      experiment: { id: experiment.id, template: experiment.template, title: experiment.title },
      recordedAt: new Date().toISOString(),
    };

    const row = await this.db.transaction(async (client) => {
      const { rows } = await client.query<PredictionRow>(
        `insert into ai.predictions
           (user_id, model_version_id, prediction_type, target_at,
            input_snapshot, prediction, confidence, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'pending')
         returning *`,
        [
          userId,
          modelVersionId,
          `experiment:${experiment.template}`,
          input.targetAt ?? null,
          JSON.stringify(inputSnapshot),
          JSON.stringify(prediction),
          basis.confidence,
        ],
      );

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'prediction.create',
          resourceType: 'prediction',
          resourceId: rows[0].id,
          metadata: {
            experimentId: experiment.id,
            basisFindingType: basis.findingType,
          },
        },
        client,
      );

      return rows[0];
    });

    // The version is joined in `list` but not present on `returning *`, so it
    // is carried through explicitly rather than falling back to a placeholder.
    return this.toPrediction({ ...row, version: evidence.modelVersion });
  }

  /**
   * Records what happened, once.
   *
   * The outcome lives in its own table with a unique constraint on the
   * prediction, so a second attempt is refused rather than overwriting the
   * first. The prediction itself is only advanced from `pending` to `matched`,
   * which is the one change its trigger permits.
   */
  async attachOutcome(
    userId: string,
    predictionId: string,
    input: AttachOutcomeInput,
  ): Promise<PredictionOutcome> {
    const prediction = await this.db.queryOne<PredictionRow>(
      'select * from ai.predictions where id = $1 and user_id = $2',
      [predictionId, userId],
    );
    if (!prediction) throw new NotFoundException('No such prediction');

    const expected = Number(
      (prediction.prediction as { expectedEffect?: unknown }).expectedEffect,
    );
    const error = Number.isFinite(expected) ? input.observedEffect - expected : null;

    return this.db.transaction(async (client) => {
      const existing = await client.query(
        'select 1 from ai.prediction_outcomes where prediction_id = $1',
        [predictionId],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new BadRequestException(
          'This prediction already has an outcome. An outcome is written once.',
        );
      }

      const { rows } = await client.query<OutcomeRow>(
        `insert into ai.prediction_outcomes
           (prediction_id, observed_at, outcome, error_summary)
         values ($1, $2, $3, $4)
         returning *`,
        [
          predictionId,
          input.observedAt,
          JSON.stringify({
            observedEffect: input.observedEffect,
            notes: input.notes ?? null,
          }),
          JSON.stringify({
            expectedEffect: Number.isFinite(expected) ? expected : null,
            observedEffect: input.observedEffect,
            // Signed, not absolute. Whether the platform over- or
            // under-estimated is the interesting half.
            error,
            absoluteError: error === null ? null : Math.abs(error),
          }),
        ],
      );

      // The only update the trigger permits, and the only one this service
      // ever makes.
      await client.query("update ai.predictions set status = 'matched' where id = $1", [
        predictionId,
      ]);

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'prediction.outcome',
          resourceType: 'prediction',
          resourceId: predictionId,
          metadata: { absoluteError: error === null ? null : Math.abs(error) },
        },
        client,
      );

      return toOutcome(rows[0]);
    });
  }

  async list(userId: string): Promise<Prediction[]> {
    const rows = await this.db.query<PredictionRow>(
      `select p.*, m.model_name, m.version
         from ai.predictions p
         join ai.model_versions m on m.id = p.model_version_id
        where p.user_id = $1
        order by p.made_at desc`,
      [userId],
    );
    return rows.map((r) => this.toPrediction(r));
  }

  async outcomeFor(userId: string, predictionId: string): Promise<PredictionOutcome | null> {
    const row = await this.db.queryOne<OutcomeRow>(
      `select o.* from ai.prediction_outcomes o
         join ai.predictions p on p.id = o.prediction_id
        where o.prediction_id = $1 and p.user_id = $2`,
      [predictionId, userId],
    );
    return row ? toOutcome(row) : null;
  }

  /** The evidence the screen would show right now, engine version included. */
  private async currentEvidence(userId: string): Promise<PatternResponse> {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return this.evidence.findings(userId, { from, to });
  }

  /**
   * The row identifying which model made this call.
   *
   * `ai.model_versions` is unique on (model_name, version), so this is an
   * upsert returning the same id for every prediction made by the same engine
   * build. Recorded by reference rather than copied into each prediction, so
   * the version a prediction was made under cannot be changed by editing the
   * prediction.
   */
  private async resolveModelVersion(engineVersion: string): Promise<string> {
    await this.db.query(
      `insert into ai.model_versions (model_name, version)
       values ('pattern-engine', $1) on conflict (model_name, version) do nothing`,
      [engineVersion],
    );
    const row = await this.db.queryOne<{ id: string }>(
      "select id from ai.model_versions where model_name = 'pattern-engine' and version = $1",
      [engineVersion],
    );
    return row!.id;
  }

  private toPrediction(row: PredictionRow): Prediction {
    return {
      id: row.id,
      userId: row.user_id,
      predictionType: row.prediction_type,
      madeAt: row.made_at,
      targetAt: row.target_at,
      // Always present in practice: `list` joins it and `create` carries it
      // through. The fallback exists so a row written by some future path
      // without one is visibly wrong rather than silently attributed.
      modelVersion: row.version ?? 'unrecorded',
      prediction: row.prediction,
      inputSnapshot: row.input_snapshot,
      confidence: row.confidence === null ? null : Number(row.confidence),
      status: row.status,
    };
  }
}

interface PredictionRow {
  id: string;
  user_id: string;
  model_version_id: string;
  prediction_type: string;
  made_at: Date;
  target_at: Date | null;
  input_snapshot: Record<string, unknown>;
  prediction: Record<string, unknown>;
  confidence: string | null;
  status: Prediction['status'];
  version?: string;
}

interface OutcomeRow {
  id: string;
  prediction_id: string;
  observed_at: Date;
  outcome: Record<string, unknown>;
  error_summary: Record<string, unknown> | null;
  created_at: Date;
}

function toOutcome(row: OutcomeRow): PredictionOutcome {
  return {
    id: row.id,
    predictionId: row.prediction_id,
    observedAt: row.observed_at,
    outcome: row.outcome,
    errorSummary: row.error_summary,
    createdAt: row.created_at,
  };
}
