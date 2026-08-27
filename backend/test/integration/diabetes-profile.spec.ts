import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { captureError, testClientConfig } from './helpers';

/**
 * The diabetes profile, end to end through the real guards and database.
 *
 * The parts worth testing here are the ones no unit test can reach: the
 * append-only trigger, the audit rows written in the same transaction as the
 * change they describe, and whether the evidence endpoint actually refuses to
 * analyse a care mode nobody has written detectors for.
 */
describe('diabetes profile', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let pool: Client;

  const email = `profile-${Date.now()}@test.local`;
  const password = 'a-very-long-test-password';
  let accessToken: string;
  let userId: string;

  const auth = () => ({ authorization: `Bearer ${accessToken}` });

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
      .send({ email, password, displayName: 'Profile' })
      .expect(201);
    accessToken = res.body.tokens.accessToken;

    const { rows } = await pool.query<{ id: string }>(
      'select id from identity.users where email = $1',
      [email],
    );
    userId = rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  describe('creation', () => {
    it('gives every new account a profile, in the registration transaction', async () => {
      // A row must exist, or the account is indistinguishable from one whose
      // registration half-failed.
      const { rows } = await pool.query<{ care_mode: string; diagnosis_source: string }>(
        'select care_mode, diagnosis_source from clinical.diabetes_profiles where user_id = $1',
        [userId],
      );
      expect(rows).toHaveLength(1);
      // Not Type 2. There is now a way to ask, so guessing would be a choice.
      expect(rows[0].care_mode).toBe('unknown');
      // `unanswered`, not `assumed`: the absence of a claim rather than a claim
      // that could be wrong.
      expect(rows[0].diagnosis_source).toBe('unanswered');
    });

    it('does not interpret anything until the question is answered', async () => {
      const res = await http().get('/api/diabetes-profile').set(auth()).expect(200);
      expect(res.body.profile.careMode).toBe('unknown');
      expect(res.body.capabilities.evidenceEnabled).toBe(false);
      expect(res.body.capabilities.unsupportedReason).toBeTruthy();
      expect(res.body.activeFlags).toEqual([]);

      const evidence = await http().get('/api/evidence').set(auth()).expect(200);
      expect(evidence.body.findings[0].findingType).toBe('care_mode_unsupported');
    });

    it('starts interpreting once the person answers', async () => {
      const saved = await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'type_2' })
        .expect(200);

      expect(saved.body.profile.careMode).toBe('type_2_standard');
      // The answer replaces the absence of one, and is marked as having come
      // from the person rather than from the platform.
      expect(saved.body.profile.diagnosisSource).toBe('self_reported');
      expect(saved.body.capabilities.evidenceEnabled).toBe(true);
      expect(saved.body.capabilities.safetyTier).toBe('standard');
    });

    it('refuses to serve a profile to an unauthenticated caller', async () => {
      await http().get('/api/diabetes-profile').expect(401);
    });
  });

  describe('care mode is derived, never supplied', () => {
    it('ignores a care mode sent by the client', async () => {
      // The request asks for Type 1 with a Type 2 care mode attached. If the
      // care mode were trusted, a Type 1 record would be handed to detectors
      // written for Type 2 physiology.
      const res = await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'type_1', careMode: 'type_2_standard' })
        .expect(200);

      expect(res.body.profile.careMode).toBe('type_1_cgm_insulin');
      expect(res.body.capabilities.safetyTier).toBe('high_risk');
      expect(res.body.capabilities.evidenceEnabled).toBe(false);
    });

    it('recomputes the care mode when a flag changes it', async () => {
      await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'type_2' })
        .expect(200);
      // Reached here having answered Type 2 above.

      const before = await http().get('/api/diabetes-profile').set(auth()).expect(200);
      expect(before.body.profile.careMode).toBe('type_2_standard');

      // Recording insulin therapy has to move the person into the mode with
      // the tighter boundaries, not just change a label.
      const after = await http()
        .post('/api/diabetes-profile/flags')
        .set(auth())
        .send({ flag: 'insulin_therapy', status: 'active' })
        .expect(201);

      expect(after.body.profile.careMode).toBe('type_2_insulin_supported');
      expect(after.body.activeFlags).toContain('insulin_therapy');
    });

    it('rejects a diagnosis outside the agreed set', async () => {
      await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'type_3' })
        .expect(400);
    });
  });

  describe('safety flags are history', () => {
    it('resolves a flag by recording that it ended, and stops counting it', async () => {
      await http()
        .post('/api/diabetes-profile/flags')
        .set(auth())
        .send({ flag: 'pregnancy', status: 'active' })
        .expect(201);

      const pregnant = await http().get('/api/diabetes-profile').set(auth()).expect(200);
      expect(pregnant.body.activeFlags).toContain('pregnancy');
      expect(pregnant.body.capabilities.safetyTier).toBe('pregnancy');

      const resolved = await http()
        .post('/api/diabetes-profile/flags')
        .set(auth())
        .send({ flag: 'pregnancy', status: 'inactive' })
        .expect(201);

      // The row that raised it is still there. Only the latest row per flag
      // decides whether it is in force.
      expect(resolved.body.activeFlags).not.toContain('pregnancy');
      expect(resolved.body.capabilities.safetyTier).not.toBe('pregnancy');

      const history = await http()
        .get('/api/diabetes-profile/flags')
        .set(auth())
        .expect(200);
      const pregnancyRows = history.body.filter(
        (f: { flag: string }) => f.flag === 'pregnancy',
      );
      expect(pregnancyRows).toHaveLength(2);
    });

    it('refuses to let a flag be rewritten or deleted', async () => {
      // Attacked directly over SQL, because the guarantee is the database's
      // and not the application's. What the platform believed about someone's
      // risk, and when, must not be quietly revised later.
      const update = await captureError(() =>
        pool.query(
          "update clinical.diabetes_safety_flags set status = 'inactive' where user_id = $1",
          [userId],
        ),
      );
      expect(update?.message).toMatch(/append-only/i);

      const remove = await captureError(() =>
        pool.query('delete from clinical.diabetes_safety_flags where user_id = $1', [
          userId,
        ]),
      );
      expect(remove?.message).toMatch(/append-only/i);
    });

    it('still lets the account be erased', async () => {
      // Migration 0013 refused every DELETE, and `user_id` cascades from
      // identity.users — so an account that had ever recorded a flag could not
      // be deleted at all, and erasure failed with a message about
      // append-only storage. Append-only means the history cannot be rewritten
      // while the person has an account; it does not mean the person cannot
      // leave.
      const { rows } = await pool.query<{ id: string }>(
        'insert into identity.users (email) values ($1) returning id',
        [`erasure-${Date.now()}@test.local`],
      );
      const doomed = rows[0].id;

      await pool.query(
        `insert into clinical.diabetes_safety_flags (user_id, flag, status, source)
         values ($1, 'pregnancy', 'active', 'self_reported')`,
        [doomed],
      );

      const failure = await captureError(() =>
        pool.query('delete from identity.users where id = $1', [doomed]),
      );
      expect(failure).toBeNull();

      const left = await pool.query(
        'select 1 from clinical.diabetes_safety_flags where user_id = $1',
        [doomed],
      );
      expect(left.rowCount).toBe(0);
    });

    it('rejects a flag name the contract does not know', async () => {
      await http()
        .post('/api/diabetes-profile/flags')
        .set(auth())
        .send({ flag: 'made_up_flag', status: 'active' })
        .expect(400);
    });
  });

  describe('audit', () => {
    it('records every profile write as a health-data change', async () => {
      const { rows } = await pool.query<{ action: string }>(
        `select action from audit.events
          where subject_user_id = $1 and action like 'diabetes_profile%'`,
        [userId],
      );
      const actions = rows.map((r) => r.action);
      expect(actions).toContain('diabetes_profile.update');
      expect(actions).toContain('diabetes_profile.flag');
    });
  });

  describe('evidence routing', () => {
    it('refuses to analyse a care mode the engine was not written for', async () => {
      await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'type_1' })
        .expect(200);

      const res = await http().get('/api/evidence').set(auth()).expect(200);

      // Not an error and not an empty list: a stated answer, in the same shape
      // as every other finding, so the screen can say why rather than go blank.
      expect(res.body.findings).toHaveLength(1);
      expect(res.body.findings[0].findingType).toBe('care_mode_unsupported');
      expect(res.body.findings[0].effectEstimate).toBeNull();
      expect(res.body.findings[0].limitations.length).toBeGreaterThan(0);
      // Crucially, no Type 2 finding leaked through.
      expect(JSON.stringify(res.body)).not.toContain('post_meal');
      expect(JSON.stringify(res.body)).not.toContain('morning_glucose_pattern');
    });

    it('analyses again once the care mode is one the engine supports', async () => {
      await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'type_2' })
        .expect(200);

      const res = await http().get('/api/evidence').set(auth()).expect(200);
      // This account has no glucose data, so the honest answer is the engine's
      // own insufficient-data finding — which proves the engine ran.
      expect(res.body.modelVersion).toMatch(/^pattern-engine-/);
    });
  });
});
