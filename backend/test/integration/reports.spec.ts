import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { testClientConfig, verifyEmailFor } from './helpers';

/**
 * The clinician packet.
 *
 * The tests that matter here are the ones about what the packet refuses to
 * say. It goes in front of a professional who will act on it, so an empty
 * section that reads like "nothing was found", a lab trend computed across two
 * incompatible units, or a question nobody's model actually asked would each be
 * worse than the packet not existing.
 */
describe('clinician packet', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let pool: Client;

  const email = `packet-${Date.now()}@test.local`;
  const password = 'a-very-long-test-password';
  let accessToken: string;
  let userId: string;
  let experimentId: string;

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
      .send({ email, password, displayName: 'Packet' })
      .expect(201);
    accessToken = registered.body.tokens.accessToken;
    await verifyEmailFor(http, pool, email);

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

    // Enough for the walk finding to exist and carry an effect estimate.
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

    const proposed = await http()
      .post('/api/experiments')
      .set(auth())
      .send({
        template: 'post_meal_walk',
        title: 'Walking after a meal',
        question: 'Does walking actually lower the rise for me?',
        protocol: { days: 6 },
      })
      .expect(201);
    experimentId = proposed.body.experiment.id;

    await http().post(`/api/experiments/${experimentId}/start`).set(auth()).expect(201);
  });

  afterAll(async () => {
    await pool?.query('delete from identity.users where id = $1', [userId]);
    await pool?.end();
    await app?.close();
  });

  describe('the period', () => {
    it('covers ninety days by default, and thirty on request', async () => {
      const ninety = await http().get('/api/reports/clinician').set(auth()).expect(200);
      expect(ninety.body.period.days).toBe(90);

      const thirty = await http()
        .get('/api/reports/clinician?days=30')
        .set(auth())
        .expect(200);
      expect(thirty.body.period.days).toBe(30);

      const span =
        new Date(thirty.body.period.to).getTime() -
        new Date(thirty.body.period.from).getTime();
      expect(Math.round(span / (24 * 60 * 60 * 1000))).toBe(30);
    });

    it('refuses a window nobody named', async () => {
      // An arbitrary range would let the period be chosen after the answer is
      // seen, which is an editable prediction in different clothes.
      for (const days of [7, 45, 365, 0]) {
        await http()
          .get(`/api/reports/clinician?days=${days}`)
          .set(auth())
          .expect(400);
      }
    });

    it('refuses an unauthenticated caller', async () => {
      await http().get('/api/reports/clinician').expect(401);
    });
  });

  describe('what it carries', () => {
    it('brings the record and the reasoning together', async () => {
      const res = await http().get('/api/reports/clinician').set(auth()).expect(200);

      expect(res.body.careMode).toBe('type_2_standard');
      expect(res.body.glucose.sampleCount).toBeGreaterThan(0);
      expect(res.body.evidence.available).toBe(true);
      expect(res.body.evidence.modelVersion).toMatch(/^pattern-engine-/);
      expect(res.body.evidence.findings.length).toBeGreaterThan(0);

      // The running experiment, with the expectation recorded before it began.
      const experiment = res.body.experiments.find(
        (e: { id: string }) => e.id === experimentId,
      );
      expect(experiment.status).toBe('active');
      expect(experiment.predicted).toBeLessThan(0);
      expect(experiment.observed).toBeNull();
      expect(experiment.modelVersion).toMatch(/^pattern-engine-/);
      expect(new Date(experiment.predictedAt).getTime()).toBeLessThanOrEqual(
        new Date(experiment.startedAt).getTime(),
      );
    });

    it('states every limitation once, however many findings carried it', async () => {
      const res = await http().get('/api/reports/clinician').set(auth()).expect(200);
      const limitations: string[] = res.body.limitations;

      expect(limitations.length).toBeGreaterThan(0);
      expect(new Set(limitations).size).toBe(limitations.length);
      // Every one of them came from a finding rather than from the packet.
      const fromFindings = new Set(
        res.body.evidence.findings.flatMap((f: { limitations: string[] }) => f.limitations),
      );
      for (const limitation of limitations) expect(fromFindings.has(limitation)).toBe(true);
    });

    it('leaves out drafts and refusals', async () => {
      // A proposal nobody started says nothing about the person in front of the
      // clinician, and a refused one would put an experiment the product
      // declined in front of a professional as if it were part of their care.
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

      const res = await http().get('/api/reports/clinician').set(auth()).expect(200);
      const ids = res.body.experiments.map((e: { id: string }) => e.id);
      expect(ids).not.toContain(blocked.body.experiment.id);
    });

    it('records that the whole record was read', async () => {
      await http().get('/api/reports/clinician').set(auth()).expect(200);

      const { rows } = await pool.query<{ action: string; metadata: { days: number } }>(
        `select action, metadata from audit.events
          where subject_user_id = $1 and action = 'report.clinician_packet'
          order by occurred_at desc limit 1`,
        [userId],
      );
      expect(rows[0].metadata.days).toBe(90);
    });
  });

  describe('labs', () => {
    it('trends a series recorded in one unit', async () => {
      for (const [monthsAgo, value] of [
        [3, 7.9],
        [2, 7.4],
        [1, 6.8],
      ] as [number, number][]) {
        await http()
          .post('/api/labs')
          .set(auth())
          .send({
            testName: 'HbA1c',
            valueNumeric: value,
            unit: '%',
            collectedAt: new Date(
              Date.now() - monthsAgo * 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            source: 'manual',
          })
          .expect(201);
      }

      const res = await http().get('/api/reports/clinician').set(auth()).expect(200);
      const series = res.body.labs.series.find(
        (l: { testName: string }) => l.testName.toLowerCase() === 'hba1c',
      );
      // Read over two years rather than the packet's ninety days, so a
      // quarterly measurement is a trend rather than a single point.
      expect(res.body.labs.windowDays).toBe(730);
      expect(series.trendable).toBe(true);
      expect(series.latest).toBe(6.8);
      // Latest minus earliest, signed, so a fall reads as a fall.
      expect(series.change).toBeCloseTo(-1.1, 5);
    });

    it('refuses to trend a series recorded in two units', async () => {
      // HbA1c is reported in % and in mmol/mol, an order of magnitude apart.
      // Subtracting across them produces a confident number meaning nothing.
      await http()
        .post('/api/labs')
        .set(auth())
        .send({
          testName: 'hba1c',
          valueNumeric: 51,
          unit: 'mmol/mol',
          collectedAt: new Date().toISOString(),
          source: 'manual',
        })
        .expect(201);

      const res = await http().get('/api/reports/clinician').set(auth()).expect(200);
      const series = res.body.labs.series.find(
        (l: { testName: string }) => l.testName.toLowerCase() === 'hba1c',
      );

      // Grouped case-insensitively: `HbA1c` and `hba1c` are one test.
      expect(series.points).toHaveLength(4);
      expect(series.trendable).toBe(false);
      expect(series.change).toBeNull();
      expect(series.notTrendableReason).toMatch(/more than one unit/i);
    });
  });

  describe('what it raises', () => {
    it('raises a result that went the other way from its prediction', async () => {
      // Direction, not magnitude. Any threshold on "how far off is worth
      // mentioning" would be a number invented here and then quoted in a
      // consulting room as though it meant something.
      await http()
        .post(`/api/experiments/${experimentId}/complete`)
        .set(auth())
        .send({ observedAt: new Date().toISOString(), observedEffect: 0.8 })
        .expect(201);

      const res = await http().get('/api/reports/clinician').set(auth()).expect(200);
      const raised = res.body.discussion.find(
        (d: { experimentId: string | null }) => d.experimentId === experimentId,
      );
      expect(raised.kind).toBe('prediction_direction_missed');
      expect(raised.because).toMatch(/opposite way/i);
      // The experiment's own question, from the shared catalogue — not an
      // interrogative composed at render time.
      expect(raised.question).toBe('Does walking actually lower the rise for me?');
    });

    it('raises a finding the model flagged, without inventing a question for it', async () => {
      // `morning_glucose_pattern` sets clinician_review_recommended when
      // mornings run above target, and the shared proposal catalogue holds no
      // experiment for it — so the packet must raise the finding and leave the
      // question null rather than writing one.
      const theirEmail = `packet-morning-${Date.now()}@test.local`;
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
      const theirId = rows[0].id;

      await http()
        .put('/api/diabetes-profile')
        .set(theirAuth)
        .send({ diabetesType: 'type_2' })
        .expect(200);

      for (let day = 0; day < 20; day += 1) {
        const morning = new Date(Date.now() - (20 - day) * 24 * 60 * 60 * 1000);
        morning.setUTCHours(7, 0, 0, 0);
        await pool.query(
          `insert into metabolic.glucose_samples (user_id, measured_at, glucose_value, unit, source)
           values ($1, $2, 11.4, 'mmol/L', 'cgm_device') on conflict do nothing`,
          [theirId, morning.toISOString()],
        );
      }

      const res = await http()
        .get('/api/reports/clinician')
        .set(theirAuth)
        .expect(200);

      const raised = res.body.discussion.find(
        (d: { findingType: string | null }) => d.findingType === 'morning_glucose_pattern',
      );
      expect(raised.kind).toBe('finding_flagged');
      expect(raised.because).toMatch(/flagged this for a professional/i);
      expect(raised.statement).toMatch(/morning glucose averaged/i);
      // The catalogue holds no experiment for this finding, so there is no
      // question — and the packet says none rather than composing one.
      expect(raised.question).toBeNull();

      await pool.query('delete from identity.users where id = $1', [theirId]);
    });

    it('says nothing rather than composing a question it does not have', async () => {
      const res = await http().get('/api/reports/clinician').set(auth()).expect(200);

      for (const point of res.body.discussion) {
        expect(['finding_flagged', 'prediction_direction_missed']).toContain(point.kind);
        // Every statement is traceable to a finding or an experiment. Nothing
        // on this list is written by the packet itself.
        expect(point.findingType ?? point.experimentId).toBeTruthy();
      }
    });
  });

  describe('a care mode with no reviewed detectors', () => {
    it('says why there are no findings instead of showing an empty list', async () => {
      // A clinician reading a blank findings section would reasonably take it
      // for "nothing was found", which is a different claim from "this was
      // never analysed".
      const theirEmail = `packet-t1-${Date.now()}@test.local`;
      const registered = await http()
        .post('/api/auth/register')
        .send({ email: theirEmail, password })
        .expect(201);
      await verifyEmailFor(http, pool, theirEmail);
      const theirAuth = {
        authorization: `Bearer ${registered.body.tokens.accessToken as string}`,
      };

      await http()
        .put('/api/diabetes-profile')
        .set(theirAuth)
        .send({ diabetesType: 'type_1' })
        .expect(200);

      const res = await http().get('/api/reports/clinician').set(theirAuth).expect(200);

      expect(res.body.evidence.available).toBe(false);
      expect(res.body.evidence.findings).toHaveLength(0);
      expect(res.body.evidence.reason).toBeTruthy();
      expect(res.body.evidence.modelVersion).toBeNull();
      // The record itself is still complete: it is the interpretation that has
      // not been built.
      expect(res.body.glucose).toBeTruthy();
      expect(res.body.period.days).toBe(90);

      await pool.query('delete from identity.users where email = $1', [theirEmail]);
    });
  });
});
