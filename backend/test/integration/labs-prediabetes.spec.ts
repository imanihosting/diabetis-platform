import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { testClientConfig, verifyEmailFor } from './helpers';

/**
 * Labs, and the prediabetes findings that read them.
 *
 * The acceptance criterion this file exists for: a real user can enter an
 * HbA1c and a weight, and /evidence uses those values. Not the seeder, not a
 * direct insert — the endpoints a browser calls.
 */
describe('labs and prediabetes evidence', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let pool: Client;

  const email = `prediab-${Date.now()}@test.local`;
  const password = 'a-very-long-test-password';
  let accessToken: string;
  let userId: string;

  const auth = () => ({ authorization: `Bearer ${accessToken}` });

  interface Finding {
    findingType: string;
    summary: string;
    effectEstimate: number | null;
    effectUnit: string | null;
    sampleCount: number;
    limitations: string[];
    wouldImproveWith: string[];
  }

  const findings = async (): Promise<Finding[]> => {
    const res = await http().get('/api/evidence').set(auth()).expect(200);
    return res.body.findings as Finding[];
  };

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
      .send({ email, password, displayName: 'Prediab' })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
    await verifyEmailFor(http, pool, email);

    const { rows } = await pool.query<{ id: string }>(
      'select id from identity.users where email = $1',
      [email],
    );
    userId = rows[0].id;

    // Glucose, so the window has something in it at all. Without it the engine
    // short-circuits on "no readings" before any detector runs. Meals too, or
    // meal_timing_association correctly returns nothing: a person who has
    // logged no meals has not failed to log enough of them.
    for (let day = 0; day < 25; day += 1) {
      const at = new Date(Date.now() - (25 - day) * 24 * 60 * 60 * 1000);
      at.setUTCHours(7, 0, 0, 0);
      await pool.query(
        `insert into metabolic.glucose_samples
           (user_id, measured_at, glucose_value, unit, source)
         values ($1, $2, $3, 'mmol/L', 'cgm_device') on conflict do nothing`,
        [userId, at.toISOString(), 5.8 + day * 0.02],
      );

      // A meal, and readings either side of it, so a post-meal response exists.
      const mealAt = new Date(at);
      mealAt.setUTCHours(12 + (day % 8), 0, 0, 0);
      await pool.query(
        `insert into nutrition.meals (user_id, started_at, meal_type, description, source)
         values ($1, $2, 'lunch', 'Test meal', 'manual')`,
        [userId, mealAt.toISOString()],
      );
      for (const [offset, value] of [
        [-10, 5.9],
        [60, 8.4 + (day % 8) * 0.1],
      ] as [number, number][]) {
        const readingAt = new Date(mealAt.getTime() + offset * 60 * 1000);
        await pool.query(
          `insert into metabolic.glucose_samples
             (user_id, measured_at, glucose_value, unit, source)
           values ($1, $2, $3, 'mmol/L', 'cgm_device') on conflict do nothing`,
          [userId, readingAt.toISOString(), value],
        );
      }
    }
  });

  afterAll(async () => {
    await pool?.query('delete from identity.users where id = $1', [userId]);
    await pool?.end();
    await app?.close();
  });

  describe('a person can record a lab result', () => {
    it('accepts an HbA1c through the API a browser uses', async () => {
      const res = await http()
        .post('/api/labs')
        .set(auth())
        .send({
          testName: 'hba1c',
          valueNumeric: 44,
          unit: 'mmol/mol',
          collectedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
          source: 'manual',
        })
        .expect(201);

      expect(res.body.testName).toBe('hba1c');
      expect(res.body.valueNumeric).toBe(44);
      // Stored as entered, with its unit beside it.
      expect(res.body.unit).toBe('mmol/mol');
    });

    it('audits the write without recording the value', async () => {
      const { rows } = await pool.query<{ metadata: Record<string, unknown> }>(
        `select metadata from audit.events
          where subject_user_id = $1 and action = 'lab.create'
          order by occurred_at desc limit 1`,
        [userId],
      );
      expect(rows[0].metadata.testName).toBe('hba1c');
      // audit.events is append-only, so anything written there can never be
      // removed. The result itself does not belong in it.
      expect(JSON.stringify(rows[0].metadata)).not.toContain('44');
    });

    it('refuses a result with neither a number nor text', async () => {
      await http()
        .post('/api/labs')
        .set(auth())
        .send({ testName: 'hba1c', collectedAt: new Date().toISOString() })
        .expect(400);
    });

    it('lists what was recorded, filtered by test', async () => {
      await http()
        .post('/api/labs')
        .set(auth())
        .send({
          testName: 'weight',
          valueNumeric: 88.5,
          unit: 'kg',
          collectedAt: new Date().toISOString(),
        })
        .expect(201);

      const all = await http().get('/api/labs').set(auth()).expect(200);
      expect(all.body.length).toBeGreaterThanOrEqual(2);

      const onlyWeight = await http()
        .get('/api/labs?testName=weight')
        .set(auth())
        .expect(200);
      expect(onlyWeight.body).toHaveLength(1);
      expect(onlyWeight.body[0].valueNumeric).toBe(88.5);
    });

    it('keeps one person’s results out of another’s list', async () => {
      const otherEmail = `other-${Date.now()}@test.local`;
      const other = await http()
        .post('/api/auth/register')
        .send({ email: otherEmail, password })
        .expect(201);
      await verifyEmailFor(http, pool, otherEmail);

      const theirs = await http()
        .get('/api/labs')
        .set({ authorization: `Bearer ${other.body.tokens.accessToken}` })
        .expect(200);
      expect(theirs.body).toHaveLength(0);
    });
  });

  describe('evidence uses those values', () => {
    beforeAll(async () => {
      // Enough HbA1c results, spread over time, for a direction to exist.
      const points: [number, number][] = [
        [400, 39],
        [300, 41],
        [200, 44],
        [100, 46],
        [20, 48],
      ];
      for (const [daysAgo, value] of points) {
        await http()
          .post('/api/labs')
          .set(auth())
          .send({
            testName: 'hba1c',
            valueNumeric: value,
            unit: 'mmol/mol',
            collectedAt: new Date(
              Date.now() - daysAgo * 24 * 60 * 60 * 1000,
            ).toISOString(),
          })
          .expect(201);
      }

      await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'prediabetes' })
        .expect(200);
    });

    it('produces the prediabetes detector set and nothing from Type 2', async () => {
      const types = (await findings()).map((f) => f.findingType);

      expect(types).toContain('hba1c_trend');
      expect(types).toContain('weight_trend');
      expect(types).toContain('fasting_glucose_trend');
      expect(types).toContain('activity_consistency');
      expect(types).toContain('meal_timing_association');

      // The Type 2 analysis assumes a different body. None of it may leak.
      expect(types).not.toContain('post_meal_walk_effect');
      expect(types).not.toContain('late_evening_meal_response');
      expect(types).not.toContain('morning_glucose_pattern');
      expect(types).not.toContain('care_mode_unsupported');
    });

    it('reads the HbA1c results the person entered', async () => {
      const trend = (await findings()).find((f) => f.findingType === 'hba1c_trend');

      // Counts exactly what the person entered, rather than a number this test
      // happens to know. Asserting against the API's own list is what proves
      // the detector is reading their record and not a fixture.
      const recorded = await http()
        .get('/api/labs?testName=hba1c')
        .set(auth())
        .expect(200);
      expect(trend?.sampleCount).toBe(recorded.body.length);
      expect(trend!.sampleCount).toBeGreaterThanOrEqual(5);
      expect(trend?.effectEstimate).not.toBeNull();
      expect(trend!.effectEstimate!).toBeGreaterThan(0);
      expect(trend?.effectUnit).toContain('mmol/mol');
      expect(trend?.summary).toContain('rising');
    });

    it('never states a trend without saying what would move it', async () => {
      for (const finding of await findings()) {
        expect(finding.limitations.length).toBeGreaterThan(0);
      }
    });

    it('only suggests things this product can actually record', async () => {
      // The rule the engine enforces on itself, checked here against real
      // output rather than against the catalogue.
      const impossible = [
        'Living Trial',
        'sleep',
        'briskly',
        'meal end times',
        'portion sizes',
      ];
      for (const finding of await findings()) {
        for (const suggestion of finding.wouldImproveWith) {
          for (const phrase of impossible) {
            expect(suggestion.toLowerCase()).not.toContain(phrase.toLowerCase());
          }
        }
      }
    });
  });
});
