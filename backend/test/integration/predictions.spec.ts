import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { captureError, testClientConfig } from './helpers';

/**
 * Predictions, and whether they can be rewritten.
 *
 * The platform's central claim is a record of how often it was right about one
 * person. That number is worth exactly nothing if the record can be revised
 * after the answer is known, so the tests that matter here are the ones trying
 * to revise it — through the API, and then directly over SQL when the API
 * offers no way.
 */
describe('predictions', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let pool: Client;

  const email = `predictions-${Date.now()}@test.local`;
  const password = 'a-very-long-test-password';
  let accessToken: string;
  let userId: string;
  let experimentId: string;
  let predictionId: string;

  const auth = () => ({ authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = () => request(app.getHttpServer());

    pool = new Client(testClientConfig());
    await pool.connect();

    const registered = await http()
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Predictions' })
      .expect(201);
    accessToken = registered.body.tokens.accessToken;

    const { rows } = await pool.query<{ id: string }>(
      'select id from identity.users where email = $1',
      [email],
    );
    userId = rows[0].id;

    await http()
      .put('/api/diabetes-profile')
      .set(auth())
      .send({ diabetesType: 'type_2' })
      .expect(200);

    // Meals with readings either side, and a walk after half of them, so the
    // walk-effect finding exists and has an effect estimate to predict.
    for (let day = 0; day < 24; day += 1) {
      const mealAt = new Date(Date.now() - (24 - day) * 24 * 60 * 60 * 1000);
      mealAt.setUTCHours(12, 30, 0, 0);
      const walked = day % 2 === 0;

      await pool.query(
        `insert into nutrition.meals (user_id, started_at, meal_type, description, source)
         values ($1, $2, 'lunch', 'Test meal', 'manual')`,
        [userId, mealAt.toISOString()],
      );
      if (walked) {
        await pool.query(
          `insert into metabolic.events (user_id, occurred_at, event_type, source, confidence, payload)
           values ($1, $2, 'exercise_started', 'manual', 1.0, '{"kind":"walk"}'::jsonb)`,
          [userId, new Date(mealAt.getTime() + 20 * 60 * 1000).toISOString()],
        );
      }
      for (const [offset, value] of [
        [-10, 6.0],
        [60, walked ? 7.6 : 9.0],
      ] as [number, number][]) {
        await pool.query(
          `insert into metabolic.glucose_samples (user_id, measured_at, glucose_value, unit, source)
           values ($1, $2, $3, 'mmol/L', 'cgm_device') on conflict do nothing`,
          [userId, new Date(mealAt.getTime() + offset * 60 * 1000).toISOString(), value],
        );
      }
    }

    const experiment = await http()
      .post('/api/experiments')
      .set(auth())
      .send({
        template: 'post_meal_walk',
        title: 'Walking after a meal',
        question: 'Does walking actually lower the rise for me?',
        protocol: { days: 6 },
      })
      .expect(201);
    experimentId = experiment.body.experiment.id;
  });

  afterAll(async () => {
    await pool?.query('delete from identity.users where id = $1', [userId]);
    await pool?.end();
    await app?.close();
  });

  describe('creating', () => {
    it('derives everything predicted from the evidence, not from the request', async () => {
      // Starting is the only way a prediction is written, and it is written in
      // the same transaction as the start. There is no endpoint that records
      // one on its own: an expectation attached to an experiment that never
      // ran could never be measured against anything.
      const started = await http()
        .post(`/api/experiments/${experimentId}/start`)
        .set(auth())
        .send({
          // None of these are inputs. If any were honoured, the accountability
          // record would be dictated by the thing being held accountable.
          prediction: { expectedEffect: 0 },
          confidence: 1,
          status: 'matched',
          modelVersion: 'made-up-v9',
        })
        .expect(201);

      const res = { body: started.body.prediction };
      predictionId = res.body.id;
      expect(res.body.status).toBe('pending');
      expect(res.body.modelVersion).toMatch(/^pattern-engine-/);
      expect(res.body.modelVersion).not.toBe('made-up-v9');

      // The walk-effect finding is negative: walking lowered the rise.
      expect(res.body.prediction.expectedEffect).toBeLessThan(0);
      expect(res.body.prediction.basisFindingType).toBe('post_meal_walk_effect');
      expect(res.body.confidence).toBeGreaterThan(0);
    });

    it('stores enough to replay the reasoning later', async () => {
      const { rows } = await pool.query<{ input_snapshot: Record<string, unknown> }>(
        'select input_snapshot from ai.predictions where id = $1',
        [predictionId],
      );
      const snapshot = rows[0].input_snapshot as Record<string, unknown>;

      // Not a reference to a finding that may since have changed: the finding
      // itself, as it read at the moment the expectation was written down.
      expect(snapshot.finding).toBeTruthy();
      expect(snapshot.careMode).toBe('type_2_standard');
      expect((snapshot.experiment as { template: string }).template).toBe(
        'post_meal_walk',
      );
    });

    it('attributes the prediction to the engine build that made it', async () => {
      const { rows } = await pool.query<{ model_name: string; version: string }>(
        `select m.model_name, m.version
           from ai.predictions p join ai.model_versions m on m.id = p.model_version_id
          where p.id = $1`,
        [predictionId],
      );
      expect(rows[0].model_name).toBe('pattern-engine');
      // Taken from the engine's own response rather than restated in
      // TypeScript, so the two cannot disagree about which model to credit.
      expect(rows[0].version).toMatch(/^pattern-engine-/);
    });

    it('refuses to predict an experiment the product will never run', async () => {
      const blocked = await http()
        .post('/api/experiments')
        .set(auth())
        .send({
          template: 'insulin_dosing',
          title: 'No',
          question: 'No',
          protocol: {},
        })
        .expect(201);

      const res = await http()
        .post(`/api/experiments/${blocked.body.experiment.id}/start`)
        .set(auth())
        .expect(400);
      expect(res.body.message).toMatch(/never run/i);

      const { rows } = await pool.query(
        'select 1 from ai.predictions where experiment_id = $1',
        [blocked.body.experiment.id],
      );
      expect(rows).toHaveLength(0);
    });

    it('records what was expected exactly once for an experiment', async () => {
      // Two expectations attached to one trial makes "what was predicted" a
      // question with two answers, and any screen showing one of them is
      // choosing which — after the fact.
      const duplicate = await captureError(() =>
        pool.query(
          `insert into ai.predictions
             (user_id, model_version_id, experiment_id, prediction_type,
              input_snapshot, prediction)
           select user_id, model_version_id, experiment_id, prediction_type,
                  input_snapshot, prediction
             from ai.predictions where id = $1`,
          [predictionId],
        ),
      );
      expect(duplicate?.message).toMatch(/predictions_one_per_experiment|duplicate key/i);
    });

    it('refuses when no current finding supports the experiment', async () => {
      const unsupported = await http()
        .post('/api/experiments')
        .set(auth())
        .send({
          template: 'hydration_logging',
          title: 'Water',
          question: 'Does drinking more water change anything?',
          protocol: {},
        })
        .expect(201);

      // Evidence moves as data arrives. An experiment proposed from a finding
      // that no longer holds has nothing to predict, and inventing a number
      // would be the exact failure this table exists to prevent.
      const res = await http()
        .post(`/api/experiments/${unsupported.body.experiment.id}/start`)
        .set(auth())
        .expect(400);
      expect(res.body.message).toMatch(/no current finding/i);
    });

    it('refuses someone else’s experiment', async () => {
      const other = await http()
        .post('/api/auth/register')
        .send({ email: `other-pred-${Date.now()}@test.local`, password })
        .expect(201);

      await http()
        .post(`/api/experiments/${experimentId}/start`)
        .set({ authorization: `Bearer ${other.body.tokens.accessToken}` })
        .expect(404);
    });

    it('offers no endpoint that writes a prediction on its own', async () => {
      // The first line of defence, as with revising one: the route does not
      // exist. Recording an expectation without starting the trial it belongs
      // to produced only rows nothing could ever measure.
      await http()
        .post('/api/predictions')
        .set(auth())
        .send({ experimentId })
        .expect(404);
    });
  });

  describe('immutability', () => {
    it('offers no way to change a prediction through the API', async () => {
      // The first line of defence is that the endpoint does not exist.
      for (const method of ['put', 'patch', 'delete'] as const) {
        const res = await http()
          [method](`/api/predictions/${predictionId}`)
          .set(auth())
          .send({ prediction: { expectedEffect: 0 } });
        expect(res.status).toBe(404);
      }
    });

    it('refuses to have its content rewritten over SQL', async () => {
      // The second line, attacked directly, because the guarantee is the
      // database's and not the application's.
      const rewrite = await captureError(() =>
        pool.query(
          `update ai.predictions set prediction = '{"expectedEffect": 0}'::jsonb where id = $1`,
          [predictionId],
        ),
      );
      expect(rewrite?.message).toMatch(/immutable/i);

      const reframe = await captureError(() =>
        pool.query(
          `update ai.predictions set input_snapshot = '{}'::jsonb where id = $1`,
          [predictionId],
        ),
      );
      expect(reframe?.message).toMatch(/immutable/i);

      const reattribute = await captureError(() =>
        pool.query('update ai.predictions set confidence = 1 where id = $1', [
          predictionId,
        ]),
      );
      expect(reattribute?.message).toMatch(/immutable/i);
    });

    it('refuses to be deleted while it still belongs to somebody', async () => {
      const removed = await captureError(() =>
        pool.query('delete from ai.predictions where id = $1', [predictionId]),
      );
      expect(removed?.message).toMatch(/immutable and cannot be deleted/i);
    });

    it('still lets the account be erased', async () => {
      // The defect this found. `ai.predictions` cascades from identity.users
      // and its trigger refused every DELETE, so an account that had ever made
      // a prediction could not be erased at all — and `prediction_outcomes`
      // was `on delete restrict`, which blocked it a second time. Immutability
      // means a prediction cannot be revised while it belongs to somebody. It
      // never meant the person cannot leave.
      const { rows } = await pool.query<{ id: string }>(
        'insert into identity.users (email) values ($1) returning id',
        [`erasure-pred-${Date.now()}@test.local`],
      );
      const doomed = rows[0].id;

      const model = await pool.query<{ id: string }>(
        `insert into ai.model_versions (model_name, version)
         values ('pattern-engine', 'erasure-probe')
         on conflict (model_name, version) do update set model_name = excluded.model_name
         returning id`,
      );
      const prediction = await pool.query<{ id: string }>(
        `insert into ai.predictions
           (user_id, model_version_id, prediction_type, input_snapshot, prediction)
         values ($1, $2, 'probe', '{}'::jsonb, '{}'::jsonb) returning id`,
        [doomed, model.rows[0].id],
      );
      await pool.query(
        `insert into ai.prediction_outcomes (prediction_id, observed_at, outcome)
         values ($1, now(), '{}'::jsonb)`,
        [prediction.rows[0].id],
      );

      const failure = await captureError(() =>
        pool.query('delete from identity.users where id = $1', [doomed]),
      );
      expect(failure).toBeNull();

      const left = await pool.query('select 1 from ai.predictions where user_id = $1', [
        doomed,
      ]);
      expect(left.rowCount).toBe(0);
      const orphans = await pool.query(
        'select 1 from ai.prediction_outcomes where prediction_id = $1',
        [prediction.rows[0].id],
      );
      expect(orphans.rowCount).toBe(0);
    });

    it('still allows the one change it is meant to', async () => {
      // Status is the single field the trigger permits, and advancing it is
      // how an outcome gets attached.
      const advanced = await captureError(() =>
        pool.query("update ai.predictions set status = 'expired' where id = $1", [
          predictionId,
        ]),
      );
      expect(advanced).toBeNull();
      await pool.query("update ai.predictions set status = 'pending' where id = $1", [
        predictionId,
      ]);
    });
  });

  describe('outcomes', () => {
    it('records what happened and scores it against what was expected', async () => {
      // Through the experiment, which is the only door. An outcome recorded
      // against a prediction on its own would leave the trial it settles
      // running with its answer already known.
      const res = await http()
        .post(`/api/experiments/${experimentId}/complete`)
        .set(auth())
        .send({ observedAt: new Date().toISOString(), observedEffect: -0.9 })
        .expect(201);

      const summary = res.body.outcome.errorSummary as {
        expectedEffect: number;
        observedEffect: number;
        error: number;
        absoluteError: number;
      };
      expect(summary.observedEffect).toBe(-0.9);
      // Signed, because whether the platform over- or under-estimated is the
      // interesting half.
      expect(summary.error).toBeCloseTo(-0.9 - summary.expectedEffect, 6);
      expect(summary.absoluteError).toBeGreaterThanOrEqual(0);
    });

    it('advances the prediction to matched, and nothing else', async () => {
      const { rows } = await pool.query<{ status: string; prediction: unknown }>(
        'select status, prediction from ai.predictions where id = $1',
        [predictionId],
      );
      expect(rows[0].status).toBe('matched');
      // The expectation itself is untouched by the outcome landing.
      expect((rows[0].prediction as { expectedEffect: number }).expectedEffect).toBeLessThan(0);
    });

    it('offers no endpoint that writes an outcome on its own', async () => {
      await http()
        .post(`/api/predictions/${predictionId}/outcome`)
        .set(auth())
        .send({ observedAt: new Date().toISOString(), observedEffect: -1.05 })
        .expect(404);
    });

    it('reads the outcome back', async () => {
      const res = await http()
        .get(`/api/predictions/${predictionId}/outcome`)
        .set(auth())
        .expect(200);
      expect(res.body.outcome.observedEffect).toBe(-0.9);
    });

    it('refuses to let the recorded outcome be rewritten over SQL', async () => {
      // The gap this test used to record as open. A prediction that cannot be
      // edited beside an outcome that can is an accountability chain with one
      // link missing, and it is the link holding the answer.
      const rewrite = await captureError(() =>
        pool.query(
          `update ai.prediction_outcomes set outcome = '{"observedEffect": -1.3}'::jsonb
            where prediction_id = $1`,
          [predictionId],
        ),
      );
      expect(rewrite?.message).toMatch(/immutable/i);

      const removed = await captureError(() =>
        pool.query('delete from ai.prediction_outcomes where prediction_id = $1', [
          predictionId,
        ]),
      );
      expect(removed?.message).toMatch(/immutable and cannot be deleted/i);

      const { rows } = await pool.query<{ outcome: { observedEffect: number } }>(
        'select outcome from ai.prediction_outcomes where prediction_id = $1',
        [predictionId],
      );
      expect(rows[0].outcome.observedEffect).toBe(-0.9);
    });
  });

  describe('listing', () => {
    it('returns the predictions made, and refuses an unauthenticated caller', async () => {
      const mine = await http().get('/api/predictions').set(auth()).expect(200);
      expect(mine.body.length).toBeGreaterThan(0);
      expect(mine.body[0].modelVersion).toMatch(/^pattern-engine-/);
      await http().get('/api/predictions').expect(401);
    });
  });
});
