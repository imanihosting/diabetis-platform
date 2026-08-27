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
import { captureError, testClientConfig } from './helpers';

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

  describe('listing', () => {
    it('returns what was proposed, and refuses an unauthenticated caller', async () => {
      const mine = await http().get('/api/experiments').set(auth()).expect(200);
      expect(mine.body.length).toBeGreaterThan(0);
      await http().get('/api/experiments').expect(401);
    });

    it('keeps one person’s experiments out of another’s list', async () => {
      const other = await http()
        .post('/api/auth/register')
        .send({ email: `other-exp-${Date.now()}@test.local`, password })
        .expect(201);

      const theirs = await http()
        .get('/api/experiments')
        .set({ authorization: `Bearer ${other.body.tokens.accessToken}` })
        .expect(200);
      expect(theirs.body).toHaveLength(0);
    });
  });
});
