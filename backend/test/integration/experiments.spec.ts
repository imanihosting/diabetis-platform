import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  ALLOWED_EXPERIMENT_TEMPLATES,
  BLOCKED_TEMPLATES,
  CLINICIAN_GATED_TEMPLATES,
  classifyTemplate,
  type CareMode,
  type DiabetesType,
  type SafetyFlag,
  type SafetyStatus,
} from '@wellovue/types';
import { AppModule } from '../../src/app.module';
import { captureError, testClientConfig, verifyEmailFor } from './helpers';

/**
 * The experiment endpoint, and whether the three layers agree.
 *
 * Until this shipped, `classifyTemplate` was a correct primitive nothing
 * called, and the database's check constraints were the only thing enforcing
 * anything. The risk in closing that gap is not that the classifier is wrong —
 * it has its own tests — but that the API and the constraints drift apart, so
 * that a decision the classifier makes is one the database will not accept.
 * That failure surfaces as a 500 on a safety path, which is the worst place
 * for one.
 *
 * So the central test here walks every template across representative
 * profiles, posts each, and checks the persisted row against both the
 * classifier's intent and the constraints in migration 0006.
 */
describe('experiments', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let pool: Client;

  const email = `experiments-${Date.now()}@test.local`;
  const password = 'a-very-long-test-password';
  let accessToken: string;
  let userId: string;

  const auth = () => ({ authorization: `Bearer ${accessToken}` });

  interface Decision {
    status: SafetyStatus;
    reason: string;
    canStart: boolean;
  }
  interface Created {
    experiment: {
      id: string;
      safetyStatus: SafetyStatus;
      clinicianReviewRequired: boolean;
      status: string;
    };
    decision: Decision;
  }

  const propose = (template: string) =>
    http()
      .post('/api/experiments')
      .set(auth())
      .send({
        template,
        title: `Trying ${template}`,
        question: 'Does this change anything for me?',
        protocol: { days: 14 },
      });

  /** Puts the account into a known care context before classifying. */
  async function setProfile(
    diabetesType: DiabetesType,
    flags: SafetyFlag[] = [],
  ): Promise<CareMode> {
    const res = await http()
      .put('/api/diabetes-profile')
      .set(auth())
      .send({ diabetesType })
      .expect(200);

    let context = res.body;
    for (const flag of ['insulin_therapy', 'pregnancy'] as SafetyFlag[]) {
      const shouldBeActive = flags.includes(flag);
      if (context.activeFlags.includes(flag) === shouldBeActive) continue;
      const updated = await http()
        .post('/api/diabetes-profile/flags')
        .set(auth())
        .send({ flag, status: shouldBeActive ? 'active' : 'inactive' })
        .expect(201);
      context = updated.body;
    }
    return context.profile.careMode as CareMode;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = () => request(app.getHttpServer());

    pool = new Client(testClientConfig());
    await pool.connect();

    const res = await http()
      .post('/api/auth/register')
      .send({ email, password, displayName: 'Experiments' })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
    // Registration leaves the account unverified, and unverified accounts are
    // refused every product route. A person clicks the link in their email
    // here; the helper does the same thing through the same endpoint.
    await verifyEmailFor(http, pool, email);

    const { rows } = await pool.query<{ id: string }>(
      'select id from identity.users where email = $1',
      [email],
    );
    userId = rows[0].id;
  });

  afterAll(async () => {
    await pool?.query('delete from identity.users where id = $1', [userId]);
    await pool?.end();
    await app?.close();
  });

  describe('a refusal is an answer, not an error', () => {
    beforeAll(async () => {
      await setProfile('type_2');
    });

    it('records a blocked experiment as a draft that can never start', async () => {
      const res = await propose('insulin_dosing').expect(201);
      const body = res.body as Created;

      // 201, not 400. Blocked insulin dosing is a real question the product
      // declines, not malformed input, and the record of it is worth keeping.
      expect(body.decision.status).toBe('blocked');
      expect(body.decision.canStart).toBe(false);
      expect(body.decision.reason).toMatch(/insulin dosing/i);

      expect(body.experiment.safetyStatus).toBe('blocked');
      expect(body.experiment.status).toBe('draft');
      expect(body.experiment.clinicianReviewRequired).toBe(false);
    });

    it('sends a gated experiment to review rather than to the person', async () => {
      const res = await propose('fasting_protocol').expect(201);
      const body = res.body as Created;

      expect(body.decision.status).toBe('clinician_gated');
      expect(body.decision.canStart).toBe(false);
      // Waiting on somebody else. `draft` would imply it is waiting on you.
      expect(body.experiment.status).toBe('awaiting_review');
      expect(body.experiment.clinicianReviewRequired).toBe(true);
    });

    it('lets an ordinary experiment start', async () => {
      const res = await propose('post_meal_walk').expect(201);
      const body = res.body as Created;

      expect(body.decision.status).toBe('allowed');
      expect(body.decision.canStart).toBe(true);
      expect(body.experiment.status).toBe('draft');
      expect(body.experiment.clinicianReviewRequired).toBe(false);
    });

    it('gates a template nobody has classified', async () => {
      const res = await propose('some_new_untriaged_protocol').expect(201);
      expect((res.body as Created).decision.status).toBe('clinician_gated');
    });
  });

  describe('the safety decision does not come from the request', () => {
    it('ignores a client trying to grant itself permission', async () => {
      await setProfile('type_2');

      const res = await http()
        .post('/api/experiments')
        .set(auth())
        .send({
          template: 'insulin_dosing',
          title: 'Trying it anyway',
          question: 'Can I?',
          protocol: {},
          // None of these are inputs. If any were honoured, the row would
          // either be a runnable insulin-dosing experiment or a constraint
          // violation returned as a 500.
          safetyStatus: 'allowed',
          clinicianReviewRequired: false,
          status: 'active',
        })
        .expect(201);

      const body = res.body as Created;
      expect(body.experiment.safetyStatus).toBe('blocked');
      expect(body.experiment.status).toBe('draft');
    });

    it('classifies against the server’s profile, not a claimed one', async () => {
      // Same template, two care contexts, nothing in the request differing.
      await setProfile('type_2');
      const withoutInsulin = await propose('medication_dose').expect(201);
      expect((withoutInsulin.body as Created).decision.status).toBe('clinician_gated');

      await setProfile('type_2', ['insulin_therapy']);
      const withInsulin = await propose('medication_dose').expect(201);
      expect((withInsulin.body as Created).decision.status).toBe('blocked');

      await setProfile('type_2');
    });
  });

  describe('API, classifier and database agree', () => {
    const PROFILES: { label: string; type: DiabetesType; flags: SafetyFlag[] }[] = [
      { label: 'Type 2, no flags', type: 'type_2', flags: [] },
      { label: 'Type 2 on insulin', type: 'type_2', flags: ['insulin_therapy'] },
      { label: 'prediabetes', type: 'prediabetes', flags: [] },
      { label: 'pregnant', type: 'type_2', flags: ['pregnancy'] },
      { label: 'unknown', type: 'unknown', flags: [] },
    ];

    const EVERY_TEMPLATE = [
      ...ALLOWED_EXPERIMENT_TEMPLATES,
      ...CLINICIAN_GATED_TEMPLATES,
      ...BLOCKED_TEMPLATES,
      'a_template_nobody_wrote',
    ];

    it('persists exactly what the classifier decided, for every template and profile', async () => {
      for (const profile of PROFILES) {
        const careMode = await setProfile(profile.type, profile.flags);

        for (const template of EVERY_TEMPLATE) {
          const expected = classifyTemplate(template, {
            careMode,
            safetyFlags: profile.flags,
          });

          const res = await propose(template).expect(201);
          const { experiment, decision } = res.body as Created;

          const where = `${profile.label} / ${template}`;
          expect(decision.status, where).toBe(expected);
          expect(experiment.safetyStatus, where).toBe(expected);

          // The database's own invariants, checked against what was written
          // rather than assumed from what was sent.
          if (expected === 'clinician_gated') {
            // experiments_gate_chk
            expect(experiment.clinicianReviewRequired, where).toBe(true);
          }
          if (expected === 'blocked') {
            // experiments_blocked_chk
            expect(['draft', 'abandoned'], where).toContain(experiment.status);
          }
          expect(decision.canStart, where).toBe(expected === 'allowed');
          expect(decision.reason.length, where).toBeGreaterThan(0);
        }
      }

      await setProfile('type_2');
    });

    it('leaves the database refusing the same things independently', async () => {
      // The second line of defence, attacked directly. If the API ever writes
      // a combination it should not, this is what stops it — so it has to
      // still be there.
      const gateSkip = await captureError(() =>
        pool.query(
          `insert into experiments.experiments
             (user_id, title, question, protocol, safety_status, clinician_review_required, status)
           values ($1, 'x', 'x', '{}'::jsonb, 'clinician_gated', false, 'draft')`,
          [userId],
        ),
      );
      expect(gateSkip?.message).toMatch(/experiments_gate_chk/);

      const runBlocked = await captureError(() =>
        pool.query(
          `insert into experiments.experiments
             (user_id, title, question, protocol, safety_status, clinician_review_required, status)
           values ($1, 'x', 'x', '{}'::jsonb, 'blocked', false, 'active')`,
          [userId],
        ),
      );
      expect(runBlocked?.message).toMatch(/experiments_blocked_chk/);
    });
  });

  describe('starting', () => {
    /** An account with enough data for the walk finding to exist. */
    async function readyAccount() {
      const theirEmail = `start-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
      const registered = await http()
        .post('/api/auth/register')
        .send({ email: theirEmail, password })
        .expect(201);
      await verifyEmailFor(http, pool, theirEmail);
      const token = registered.body.tokens.accessToken as string;
      const theirAuth = { authorization: `Bearer ${token}` };

      const { rows } = await pool.query<{ id: string }>(
        'select id from identity.users where email = $1',
        [theirEmail],
      );
      const id = rows[0].id;

      await http()
        .put('/api/diabetes-profile')
        .set(theirAuth)
        .send({ diabetesType: 'type_2' })
        .expect(200);

      for (let day = 0; day < 24; day += 1) {
        const mealAt = new Date(Date.now() - (24 - day) * 24 * 60 * 60 * 1000);
        mealAt.setUTCHours(12, 30, 0, 0);
        const walked = day % 2 === 0;
        await pool.query(
          `insert into nutrition.meals (user_id, started_at, meal_type, description, source)
           values ($1, $2, 'lunch', 'Test meal', 'manual')`,
          [id, mealAt.toISOString()],
        );
        if (walked) {
          await pool.query(
            `insert into metabolic.events (user_id, occurred_at, event_type, source, confidence, payload)
             values ($1, $2, 'exercise_started', 'manual', 1.0, '{"kind":"walk"}'::jsonb)`,
            [id, new Date(mealAt.getTime() + 20 * 60 * 1000).toISOString()],
          );
        }
        for (const [offset, value] of [
          [-10, 6.0],
          [60, walked ? 7.6 : 9.0],
        ] as [number, number][]) {
          await pool.query(
            `insert into metabolic.glucose_samples (user_id, measured_at, glucose_value, unit, source)
             values ($1, $2, $3, 'mmol/L', 'cgm_device') on conflict do nothing`,
            [id, new Date(mealAt.getTime() + offset * 60 * 1000).toISOString(), value],
          );
        }
      }
      return { id, auth: theirAuth };
    }

    const proposeAs = (
      headers: Record<string, string>,
      template: string,
      title = 'Walking after a meal',
    ) =>
      http()
        .post('/api/experiments')
        .set(headers)
        .send({ template, title, question: 'Does it help?', protocol: { days: 6 } });

    it('records the prediction and activates, in that order', async () => {
      const account = await readyAccount();
      const proposed = await proposeAs(account.auth, 'post_meal_walk').expect(201);
      const id = proposed.body.experiment.id as string;

      const res = await http()
        .post(`/api/experiments/${id}/start`)
        .set(account.auth)
        .expect(201);

      expect(res.body.experiment.status).toBe('active');
      expect(res.body.experiment.startedAt).toBeTruthy();
      expect(res.body.prediction.status).toBe('pending');
      expect(res.body.prediction.prediction.expectedEffect).toBeLessThan(0);

      // The order is the claim. `made_at` defaults to the moment of insert and
      // `started_at` is set afterwards in the same transaction, so the
      // prediction cannot be later than the start.
      const { rows } = await pool.query<{ made_at: Date; started_at: Date }>(
        `select p.made_at, e.started_at
           from ai.predictions p join experiments.experiments e on e.id = p.experiment_id
          where e.id = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].made_at.getTime()).toBeLessThanOrEqual(rows[0].started_at.getTime());
    });

    it('refuses a blocked experiment outright', async () => {
      const account = await readyAccount();
      const blocked = await proposeAs(account.auth, 'insulin_dosing', 'No').expect(201);

      const res = await http()
        .post(`/api/experiments/${blocked.body.experiment.id}/start`)
        .set(account.auth)
        .expect(400);
      expect(res.body.message).toMatch(/never run/i);
    });

    it('leaves a clinician-gated experiment waiting', async () => {
      const account = await readyAccount();
      const gated = await proposeAs(account.auth, 'fasting_protocol', 'Fasting').expect(
        201,
      );

      const res = await http()
        .post(`/api/experiments/${gated.body.experiment.id}/start`)
        .set(account.auth)
        .expect(400);
      // No review workflow exists, so the message must not imply a queue.
      expect(res.body.message).toMatch(/no way to record that agreement yet/i);
    });

    it('refuses to start the same experiment twice', async () => {
      const account = await readyAccount();
      const proposed = await proposeAs(account.auth, 'post_meal_walk').expect(201);
      const id = proposed.body.experiment.id as string;

      await http().post(`/api/experiments/${id}/start`).set(account.auth).expect(201);
      await http().post(`/api/experiments/${id}/start`).set(account.auth).expect(409);

      // And exactly one prediction exists for it.
      const { rows } = await pool.query(
        'select 1 from ai.predictions where experiment_id = $1',
        [id],
      );
      expect(rows).toHaveLength(1);
    });

    it('rolls the start back when the prediction cannot be written', async () => {
      // The failure this whole design is for. `hydration_logging` is allowed,
      // so the safety gate lets it through, but no current finding supports it
      // — so the prediction cannot be made. The experiment must not be left
      // running with no record of what was expected.
      const account = await readyAccount();
      const unsupported = await proposeAs(
        account.auth,
        'hydration_logging',
        'Water',
      ).expect(201);
      const id = unsupported.body.experiment.id as string;

      await http().post(`/api/experiments/${id}/start`).set(account.auth).expect(400);

      const { rows } = await pool.query<{ status: string; started_at: Date | null }>(
        'select status, started_at from experiments.experiments where id = $1',
        [id],
      );
      expect(rows[0].status).toBe('draft');
      expect(rows[0].started_at).toBeNull();
    });

    it('refuses someone else’s experiment', async () => {
      const mine = await readyAccount();
      const theirs = await readyAccount();
      const proposed = await proposeAs(mine.auth, 'post_meal_walk').expect(201);

      await http()
        .post(`/api/experiments/${proposed.body.experiment.id}/start`)
        .set(theirs.auth)
        .expect(404);
    });

    it('is refused by the database independently of the API', async () => {
      // The second line. A future caller that flips the status without writing
      // a prediction first is stopped here rather than trusted.
      const account = await readyAccount();
      const proposed = await proposeAs(account.auth, 'post_meal_walk').expect(201);
      const id = proposed.body.experiment.id as string;

      const activated = await captureError(() =>
        pool.query(
          "update experiments.experiments set status = 'active' where id = $1",
          [id],
        ),
      );
      expect(activated?.message).toMatch(/without a prediction recorded first/i);

      // And an experiment inserted straight into `active` is refused too, so
      // the transition cannot simply be skipped.
      const inserted = await captureError(() =>
        pool.query(
          `insert into experiments.experiments
             (user_id, template, title, question, protocol, safety_status,
              clinician_review_required, status)
           values ($1, 'post_meal_walk', 'x', 'x', '{}'::jsonb, 'allowed', false, 'active')`,
          [account.id],
        ),
      );
      expect(inserted?.message).toMatch(/without a prediction recorded first/i);
    });

    it('refuses to let a prediction be moved onto another experiment', async () => {
      const account = await readyAccount();
      const first = await proposeAs(account.auth, 'post_meal_walk').expect(201);
      const second = await proposeAs(account.auth, 'post_meal_walk', 'Another').expect(
        201,
      );
      await http()
        .post(`/api/experiments/${first.body.experiment.id}/start`)
        .set(account.auth)
        .expect(201);

      // Reassignment is the same failure as editing: the expectation would end
      // up attached to a question it was not made about.
      const moved = await captureError(() =>
        pool.query(
          'update ai.predictions set experiment_id = $2 where experiment_id = $1',
          [first.body.experiment.id, second.body.experiment.id],
        ),
      );
      expect(moved?.message).toMatch(/immutable/i);
    });
  });

  describe('finishing', () => {
    /** An account with enough data for the walk finding to exist. */
    async function running() {
      const theirEmail = `finish-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
      const registered = await http()
        .post('/api/auth/register')
        .send({ email: theirEmail, password })
        .expect(201);
      await verifyEmailFor(http, pool, theirEmail);
      const theirAuth = {
        authorization: `Bearer ${registered.body.tokens.accessToken as string}`,
      };

      const { rows } = await pool.query<{ id: string }>(
        'select id from identity.users where email = $1',
        [theirEmail],
      );
      const id = rows[0].id;

      await http()
        .put('/api/diabetes-profile')
        .set(theirAuth)
        .send({ diabetesType: 'type_2' })
        .expect(200);

      for (let day = 0; day < 24; day += 1) {
        const mealAt = new Date(Date.now() - (24 - day) * 24 * 60 * 60 * 1000);
        mealAt.setUTCHours(12, 30, 0, 0);
        const walked = day % 2 === 0;
        await pool.query(
          `insert into nutrition.meals (user_id, started_at, meal_type, description, source)
           values ($1, $2, 'lunch', 'Test meal', 'manual')`,
          [id, mealAt.toISOString()],
        );
        if (walked) {
          await pool.query(
            `insert into metabolic.events (user_id, occurred_at, event_type, source, confidence, payload)
             values ($1, $2, 'exercise_started', 'manual', 1.0, '{"kind":"walk"}'::jsonb)`,
            [id, new Date(mealAt.getTime() + 20 * 60 * 1000).toISOString()],
          );
        }
        for (const [offset, value] of [
          [-10, 6.0],
          [60, walked ? 7.6 : 9.0],
        ] as [number, number][]) {
          await pool.query(
            `insert into metabolic.glucose_samples (user_id, measured_at, glucose_value, unit, source)
             values ($1, $2, $3, 'mmol/L', 'cgm_device') on conflict do nothing`,
            [id, new Date(mealAt.getTime() + offset * 60 * 1000).toISOString(), value],
          );
        }
      }

      const proposed = await http()
        .post('/api/experiments')
        .set(theirAuth)
        .send({
          template: 'post_meal_walk',
          title: 'Walking after a meal',
          question: 'Does it help?',
          protocol: { days: 6 },
        })
        .expect(201);
      const experimentId = proposed.body.experiment.id as string;

      await http()
        .post(`/api/experiments/${experimentId}/start`)
        .set(theirAuth)
        .expect(201);

      return { id, auth: theirAuth, experimentId };
    }

    it('records the outcome and finishes, scoring it against what was expected', async () => {
      const account = await running();
      const observedAt = new Date();

      const res = await http()
        .post(`/api/experiments/${account.experimentId}/complete`)
        .set(account.auth)
        .send({ observedAt: observedAt.toISOString(), observedEffect: -0.9 })
        .expect(201);

      expect(res.body.experiment.status).toBe('completed');
      expect(res.body.experiment.endedAt).toBeTruthy();
      // The prediction advances to matched, and its content is untouched.
      expect(res.body.prediction.status).toBe('matched');
      expect(res.body.prediction.prediction.expectedEffect).toBeLessThan(0);

      const summary = res.body.outcome.errorSummary as {
        expectedEffect: number;
        observedEffect: number;
        error: number;
        absoluteError: number;
      };
      expect(summary.observedEffect).toBe(-0.9);
      expect(summary.error).toBeCloseTo(-0.9 - summary.expectedEffect, 6);
      expect(summary.absoluteError).toBe(Math.abs(summary.error));
    });

    it('ends the experiment when it was measured, not when the form was sent', async () => {
      // Somebody recording Friday's result on Sunday is the ordinary case, and
      // an end date disagreeing with the measurement it holds makes the record
      // unusable later.
      const account = await running();
      const observedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      await http()
        .post(`/api/experiments/${account.experimentId}/complete`)
        .set(account.auth)
        .send({ observedAt: observedAt.toISOString(), observedEffect: -1.1 })
        .expect(201);

      const { rows } = await pool.query<{ ended_at: Date }>(
        'select ended_at from experiments.experiments where id = $1',
        [account.experimentId],
      );
      expect(rows[0].ended_at.getTime()).toBe(observedAt.getTime());
    });

    it('records a result once', async () => {
      // A second attempt is refused rather than replacing a disappointing
      // result with a better one.
      const account = await running();
      const body = { observedAt: new Date().toISOString(), observedEffect: -0.9 };

      await http()
        .post(`/api/experiments/${account.experimentId}/complete`)
        .set(account.auth)
        .send(body)
        .expect(201);

      const second = await http()
        .post(`/api/experiments/${account.experimentId}/complete`)
        .set(account.auth)
        .send({ ...body, observedEffect: -1.3 })
        .expect(409);
      expect(second.body.message).toMatch(/already finished/i);

      const { rows } = await pool.query<{ outcome: { observedEffect: number } }>(
        `select o.outcome from ai.prediction_outcomes o
           join ai.predictions p on p.id = o.prediction_id
          where p.experiment_id = $1`,
        [account.experimentId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].outcome.observedEffect).toBe(-0.9);
    });

    it('refuses to measure an experiment that never ran', async () => {
      const account = await running();
      const draft = await http()
        .post('/api/experiments')
        .set(account.auth)
        .send({
          template: 'post_meal_walk',
          title: 'Not started',
          question: 'Does it help?',
          protocol: { days: 6 },
        })
        .expect(201);

      const res = await http()
        .post(`/api/experiments/${draft.body.experiment.id}/complete`)
        .set(account.auth)
        .send({ observedAt: new Date().toISOString(), observedEffect: -0.9 })
        .expect(409);
      expect(res.body.message).toMatch(/no run to measure/i);
    });

    it('refuses someone else’s experiment', async () => {
      const mine = await running();
      const theirs = await running();

      await http()
        .post(`/api/experiments/${mine.experimentId}/complete`)
        .set(theirs.auth)
        .send({ observedAt: new Date().toISOString(), observedEffect: -0.9 })
        .expect(404);
    });

    it('is refused by the database independently of the API', async () => {
      // The second line, and the mirror of 0018. A future caller that finishes
      // an experiment without measuring it is stopped here rather than
      // trusted: a loop that can write down what it expects and then end
      // without saying what happened keeps only the flattering half.
      const account = await running();

      const finished = await captureError(() =>
        pool.query(
          "update experiments.experiments set status = 'completed' where id = $1",
          [account.experimentId],
        ),
      );
      expect(finished?.message).toMatch(/without an outcome recorded/i);
    });

    it('still allows an experiment to be abandoned unmeasured', async () => {
      // Giving up without measuring is an honest end, and the status says so.
      // It is completion specifically that asserts there is an answer.
      const account = await running();

      const abandoned = await captureError(() =>
        pool.query(
          "update experiments.experiments set status = 'abandoned' where id = $1",
          [account.experimentId],
        ),
      );
      expect(abandoned).toBeNull();
    });

    it('rolls the completion back when the outcome cannot be written', async () => {
      // The failure this design is for, approached from the other side: the
      // outcome write is refused because one already exists, and the
      // experiment must not be left in a state that says otherwise.
      const account = await running();
      const body = { observedAt: new Date().toISOString(), observedEffect: -0.9 };

      await http()
        .post(`/api/experiments/${account.experimentId}/complete`)
        .set(account.auth)
        .send(body)
        .expect(201);

      // Put it back to active over SQL, so the service's own status check is
      // not what refuses, and the outcome write is reached a second time.
      await pool.query(
        "update experiments.experiments set status = 'active' where id = $1",
        [account.experimentId],
      );

      const res = await http()
        .post(`/api/experiments/${account.experimentId}/complete`)
        .set(account.auth)
        .send({ ...body, observedEffect: -1.3 })
        .expect(400);
      expect(res.body.message).toMatch(/written once/i);

      const { rows } = await pool.query<{ status: string }>(
        'select status from experiments.experiments where id = $1',
        [account.experimentId],
      );
      expect(rows[0].status).toBe('active');
    });
  });

  describe('reading one', () => {
    it('returns the experiment, the prediction and the outcome together', async () => {
      const account = await (async () => {
        const theirEmail = `detail-${Date.now()}@test.local`;
        const registered = await http()
          .post('/api/auth/register')
          .send({ email: theirEmail, password })
          .expect(201);
        await verifyEmailFor(http, pool, theirEmail);
        return {
          auth: {
            authorization: `Bearer ${registered.body.tokens.accessToken as string}`,
          },
        };
      })();

      const proposed = await http()
        .post('/api/experiments')
        .set(account.auth)
        .send({
          template: 'insulin_dosing',
          title: 'No',
          question: 'No',
          protocol: {},
        })
        .expect(201);

      const res = await http()
        .get(`/api/experiments/${proposed.body.experiment.id}`)
        .set(account.auth)
        .expect(200);

      expect(res.body.experiment.safetyStatus).toBe('blocked');
      // A blocked experiment never gets either, and both come back as null
      // rather than being absent — the screen has to distinguish "not yet"
      // from "never".
      expect(res.body.prediction).toBeNull();
      expect(res.body.outcome).toBeNull();
    });

    it('refuses someone else’s experiment, and an unauthenticated caller', async () => {
      const mine = await http()
        .post('/api/experiments')
        .set(auth())
        .send({
          template: 'post_meal_walk',
          title: 'Mine',
          question: 'Does it help?',
          protocol: {},
        })
        .expect(201);
      const id = mine.body.experiment.id as string;

      const otherEmail = `other-detail-${Date.now()}@test.local`;
      const other = await http()
        .post('/api/auth/register')
        .send({ email: otherEmail, password })
        .expect(201);
      await verifyEmailFor(http, pool, otherEmail);

      await http()
        .get(`/api/experiments/${id}`)
        .set({ authorization: `Bearer ${other.body.tokens.accessToken}` })
        .expect(404);
      await http().get(`/api/experiments/${id}`).expect(401);
    });
  });

  describe('listing', () => {
    it('returns what was proposed, and refuses an unauthenticated caller', async () => {
      const mine = await http().get('/api/experiments').set(auth()).expect(200);
      expect(mine.body.length).toBeGreaterThan(0);
      await http().get('/api/experiments').expect(401);
    });

    it('keeps one person’s experiments out of another’s list', async () => {
      const otherEmail = `other-exp-${Date.now()}@test.local`;
      const other = await http()
        .post('/api/auth/register')
        .send({ email: otherEmail, password })
        .expect(201);
      await verifyEmailFor(http, pool, otherEmail);

      const theirs = await http()
        .get('/api/experiments')
        .set({ authorization: `Bearer ${other.body.tokens.accessToken}` })
        .expect(200);
      expect(theirs.body).toHaveLength(0);
    });
  });
});
