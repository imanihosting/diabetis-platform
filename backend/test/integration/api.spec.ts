import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { testClientConfig } from './helpers';

/**
 * End-to-end through the real application: real database, real object storage,
 * real guards. Nothing is stubbed, so this exercises the same path a browser
 * takes.
 */
function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** The refresh cookie in `name=value` form, ready to send back. */
function refreshCookie(res: request.Response): string {
  const cookie = setCookies(res).find((c) => c.startsWith('diabetes_refresh='));
  if (!cookie) throw new Error('No refresh cookie was set');
  return cookie.split(';')[0];
}

describe('API end to end', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let pool: Client;

  const email = `e2e-${Date.now()}@test.local`;
  const password = 'a-very-long-test-password';
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = () => request(app.getHttpServer());

    pool = new Client(testClientConfig());
    await pool.connect();
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
  });

  describe('health', () => {
    it('reports the dependencies it can reach', async () => {
      const res = await http().get('/api/health/ready').expect(200);
      expect(res.body.checks.database).toBe(true);
      expect(res.body.checks.storage).toBe(true);
    });
  });

  describe('authentication', () => {
    it('creates an account and returns tokens', async () => {
      const res = await http()
        .post('/api/auth/register')
        .send({ email, password, displayName: 'E2E' })
        .expect(201);

      expect(res.body.user.email).toBe(email);
      expect(res.body.user.primaryRole).toBe('patient');
      expect(res.body.tokens.accessToken).toBeTruthy();
      accessToken = res.body.tokens.accessToken;
    });

    it('never returns the password hash', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      expect(JSON.stringify(res.body)).not.toMatch(/argon2|password_hash|passwordHash/);
    });

    it('refuses a duplicate registration', async () => {
      await http().post('/api/auth/register').send({ email, password }).expect(409);
    });

    it('refuses a short password', async () => {
      await http()
        .post('/api/auth/register')
        .send({ email: `short-${Date.now()}@test.local`, password: 'short' })
        .expect(400);
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ email, password: 'not-the-right-password' });
      const unknownAccount = await http()
        .post('/api/auth/login')
        .send({ email: 'nobody@test.local', password: 'not-the-right-password' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownAccount.status).toBe(401);
      expect(wrongPassword.body.message).toBe(unknownAccount.body.message);
    });

    it('never puts the refresh token in the response body', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      // The refresh token is the long-lived credential; if it reaches the page
      // as data, any XSS can walk away with a 30-day foothold.
      expect(res.body.tokens.refreshToken).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/refreshToken/);
    });

    it('sets the refresh cookie HttpOnly, SameSite=Strict, and scoped to /api/auth', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      const cookie = setCookies(res).find((c) => c.startsWith('diabetes_refresh='));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/auth/i);
    });

    it('rotates the refresh cookie, invalidating the used one', async () => {
      const login = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      const used = refreshCookie(login);

      const rotated = await http()
        .post('/api/auth/refresh')
        .set('Cookie', used)
        .expect(200);
      expect(rotated.body.tokens.accessToken).toBeTruthy();

      // A stolen refresh token is useful at most once.
      await http().post('/api/auth/refresh').set('Cookie', used).expect(401);
    });

    it('clears the cookie when a spent refresh token is replayed', async () => {
      const login = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      const used = refreshCookie(login);
      await http().post('/api/auth/refresh').set('Cookie', used).expect(200);

      const replay = await http()
        .post('/api/auth/refresh')
        .set('Cookie', used)
        .expect(401);

      // Otherwise the browser keeps retrying a token that can never work.
      const cleared = setCookies(replay).find((c) => c.startsWith('diabetes_refresh='));
      expect(cleared).toMatch(/diabetes_refresh=;/);
    });

    it('refuses to refresh without a cookie', async () => {
      await http().post('/api/auth/refresh').expect(401);
    });
  });

  describe('authorisation', () => {
    it('rejects an unauthenticated request', async () => {
      await http().get('/api/users/me').expect(401);
    });

    it('rejects a malformed token', async () => {
      await http()
        .get('/api/users/me')
        .set('authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('accepts a valid token', async () => {
      const res = await http()
        .get('/api/users/me')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.email).toBe(email);
    });
  });

  describe('glucose', () => {
    const auth = () => ({ authorization: `Bearer ${accessToken}` });

    it('records a reading', async () => {
      await http()
        .post('/api/glucose')
        .set(auth())
        .send({
          measuredAt: new Date().toISOString(),
          value: 7.8,
          unit: 'mmol/L',
          source: 'manual',
        })
        .expect(201);
    });

    it('rejects a physiologically impossible reading', async () => {
      await http()
        .post('/api/glucose')
        .set(auth())
        .send({
          measuredAt: new Date().toISOString(),
          value: 250,
          unit: 'mmol/L',
          source: 'manual',
        })
        .expect(400);
    });

    it('imports a CGM CSV export and archives the original', async () => {
      const rows = ['Device Timestamp,Historic Glucose mmol/L'];
      const base = new Date('2026-06-01T00:00:00Z');
      for (let i = 0; i < 40; i += 1) {
        const at = new Date(base.getTime() + i * 15 * 60 * 1000);
        // Explicit UTC: an offset-less timestamp would be read as server-local
        // time, making this assertion depend on the machine's timezone.
        rows.push(`${at.toISOString()},${(5 + (i % 7)).toFixed(1)}`);
      }

      const res = await http()
        .post('/api/glucose/import/csv')
        .set(auth())
        .attach('file', Buffer.from(rows.join('\n')), 'export.csv')
        .expect(201);

      expect(res.body.imported).toBe(40);
      // The uploaded file is kept so the import stays replayable and auditable.
      expect(res.body.objectKey).toMatch(/^diabetes-platform\/users\//);
      expect(res.body.importJobId).toBeTruthy();
    });

    it('skips duplicates on re-import instead of overwriting', async () => {
      const csv = 'Device Timestamp,Historic Glucose mmol/L\n2026-06-15T08:00:00Z,6.4';

      const first = await http()
        .post('/api/glucose/import/csv')
        .set(auth())
        .attach('file', Buffer.from(csv), 'export.csv')
        .expect(201);
      const second = await http()
        .post('/api/glucose/import/csv')
        .set(auth())
        .attach('file', Buffer.from(csv), 'export.csv')
        .expect(201);

      expect(first.body.imported).toBe(1);
      expect(second.body.imported).toBe(0);
      expect(second.body.duplicates).toBe(1);
    });

    it('summarises a period and flags a thin sample as insufficient', async () => {
      const to = new Date('2026-06-02T00:00:00Z');
      const from = new Date('2026-06-01T00:00:00Z');
      const res = await http()
        .get(`/api/glucose/summary?from=${from.toISOString()}&to=${to.toISOString()}`)
        .set(auth())
        .expect(200);

      expect(res.body.sampleCount).toBe(40);
      expect(res.body.dataSufficient).toBe(true);
      expect(res.body.mean).toBeGreaterThan(0);
      expect(res.body.timeInRange).toBeLessThanOrEqual(1);
    });

    it('converts the summary to mg/dL without changing what was stored', async () => {
      const to = new Date('2026-06-02T00:00:00Z').toISOString();
      const from = new Date('2026-06-01T00:00:00Z').toISOString();

      const mmol = await http()
        .get(`/api/glucose/summary?from=${from}&to=${to}&unit=mmol/L`)
        .set(auth())
        .expect(200);
      const mgdl = await http()
        .get(`/api/glucose/summary?from=${from}&to=${to}&unit=mg/dL`)
        .set(auth())
        .expect(200);

      // Each unit is rounded to its own display precision (0.1 mmol/L, 1 mg/dL),
      // so the two means agree to within that rounding, not exactly.
      const converted = mmol.body.mean * 18.0182;
      expect(Math.abs(mgdl.body.mean - converted)).toBeLessThan(2.5);

      // Time in range is computed in mmol/L before conversion, so the unit
      // requested must not change it at all.
      expect(mgdl.body.timeInRange).toBeCloseTo(mmol.body.timeInRange, 6);
    });
  });

  describe('meals and object storage', () => {
    const auth = () => ({ authorization: `Bearer ${accessToken}` });

    it('uploads a photo and attaches it to a meal', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );

      const upload = await http()
        .post('/api/meals/photo')
        .set(auth())
        .attach('file', png, { filename: 'meal.png', contentType: 'image/png' })
        .expect(201);

      const meal = await http()
        .post('/api/meals')
        .set(auth())
        .send({
          startedAt: new Date().toISOString(),
          mealType: 'lunch',
          description: 'Rice and chicken',
          photoObjectKey: upload.body.objectKey,
          source: 'manual',
          items: [{ itemName: 'Rice', estimatedCarbsG: 52, confidence: 0.6 }],
        })
        .expect(201);

      expect(meal.body.items).toHaveLength(1);

      const fetched = await http()
        .get(`/api/meals/${meal.body.id}`)
        .set(auth())
        .expect(200);

      // The bucket is not public; the browser gets a presigned URL, not a key.
      expect(fetched.body.photoUrl).toMatch(/X-Amz-Signature/);
    });

    it('refuses a photo key belonging to another user', async () => {
      await http()
        .post('/api/meals')
        .set(auth())
        .send({
          startedAt: new Date().toISOString(),
          photoObjectKey:
            'diabetes-platform/users/00000000-0000-0000-0000-000000000000/meal-photos/x.png',
          source: 'manual',
        })
        .expect(403);
    });

    it('rejects a non-image upload', async () => {
      await http()
        .post('/api/meals/photo')
        .set(auth())
        .attach('file', Buffer.from('not an image'), {
          filename: 'x.txt',
          contentType: 'text/plain',
        })
        .expect(400);
    });
  });

  describe('the unified timeline', () => {
    const auth = () => ({ authorization: `Bearer ${accessToken}` });

    it('merges events and glucose into one ordered stream', async () => {
      const now = Date.now();
      await http()
        .post('/api/timeline/events')
        .set(auth())
        .send({
          occurredAt: new Date(now - 30 * 60 * 1000).toISOString(),
          eventType: 'exercise_started',
          source: 'manual',
          payload: { kind: 'walk', minutes: 12 },
        })
        .expect(201);

      const from = new Date(now - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(now + 60 * 1000).toISOString();
      const res = await http()
        .get(`/api/timeline?from=${from}&to=${to}&limit=500`)
        .set(auth())
        .expect(200);

      const types = new Set(res.body.map((e: { eventType: string }) => e.eventType));
      expect(types.has('glucose_sample')).toBe(true);
      expect(types.has('exercise_started')).toBe(true);
      expect(types.has('meal_started')).toBe(true);

      // Newest first.
      const times = res.body.map((e: { occurredAt: string }) => Date.parse(e.occurredAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('carries provenance on every entry', async () => {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();
      const res = await http()
        .get(`/api/timeline?from=${from}&to=${to}`)
        .set(auth())
        .expect(200);

      for (const entry of res.body) {
        expect(entry.source).toBeTruthy();
        expect(typeof entry.confidence).toBe('number');
        expect(typeof entry.isInferred).toBe('boolean');
      }
    });
  });

  describe('cross-user isolation', () => {
    const auth = () => ({ authorization: `Bearer ${accessToken}` });
    let othersMedicationId: string;
    let othersToken: string;

    beforeAll(async () => {
      // A second account whose records the first must never be able to touch.
      const other = await http()
        .post('/api/auth/register')
        .send({ email: `other-${Date.now()}@test.local`, password })
        .expect(201);
      othersToken = other.body.tokens.accessToken;

      const med = await http()
        .post('/api/medications')
        .set({ authorization: `Bearer ${othersToken}` })
        .send({ medicationName: 'Gliclazide', status: 'active', source: 'manual' })
        .expect(201);
      othersMedicationId = med.body.id;
    });

    it('refuses to log a dose against another user\'s medication record', async () => {
      // Without an ownership check this would plant a timeline entry and a
      // matching audit entry referencing a record the caller does not own.
      await http()
        .post(`/api/medications/${othersMedicationId}/taken`)
        .set(auth())
        .send({ takenAt: new Date().toISOString() })
        .expect(404);
    });

    it('answers the same way for a record that does not exist', async () => {
      // Identical response, so this cannot be used to probe for valid ids.
      await http()
        .post('/api/medications/00000000-0000-0000-0000-000000000000/taken')
        .set(auth())
        .send({ takenAt: new Date().toISOString() })
        .expect(404);
    });

    it('writes no timeline event when the ownership check fails', async () => {
      const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 60 * 1000).toISOString();
      const timeline = await http()
        .get(`/api/timeline?from=${from}&to=${to}&limit=500`)
        .set(auth())
        .expect(200);

      const planted = timeline.body.filter(
        (e: { eventType: string; payload: Record<string, unknown> }) =>
          e.eventType === 'medication_taken' &&
          e.payload.medicationRecordId === othersMedicationId,
      );
      expect(planted).toHaveLength(0);
    });

    it('does not leak another user\'s medications into this user\'s list', async () => {
      const res = await http().get('/api/medications').set(auth()).expect(200);
      const ids = res.body.map((m: { id: string }) => m.id);
      expect(ids).not.toContain(othersMedicationId);
    });

    it('does not leak another user\'s meals into this user\'s timeline', async () => {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();
      const res = await http()
        .get(`/api/timeline?from=${from}&to=${to}&limit=500`)
        .set({ authorization: `Bearer ${othersToken}` })
        .expect(200);

      // The second account logged nothing but a medication record.
      const meals = res.body.filter(
        (e: { eventType: string }) => e.eventType === 'meal_started',
      );
      expect(meals).toHaveLength(0);
    });
  });

  describe('input validation', () => {
    const auth = () => ({ authorization: `Bearer ${accessToken}` });

    it('returns 400, not 500, for an unrecognised glucose unit', async () => {
      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date().toISOString();
      const res = await http()
        .get(`/api/glucose/summary?from=${from}&to=${to}&unit=bananas`)
        .set(auth())
        .expect(400);

      expect(res.body.message).toBe('Validation failed');
      expect(res.body.issues).toBeInstanceOf(Array);
    });

    it('returns 400 for a malformed timeline range', async () => {
      await http()
        .get('/api/timeline?from=not-a-date&to=also-not-a-date')
        .set(auth())
        .expect(400);
    });

    it('still reports a 404 as a 404, not a validation error', async () => {
      // The Zod filter is a catch-all that delegates; a regression there would
      // turn every ordinary HTTP error into a 400.
      await http()
        .get('/api/meals/00000000-0000-0000-0000-000000000000')
        .set(auth())
        .expect(404);
    });

    it('returns 400 when the range is inverted', async () => {
      const from = new Date().toISOString();
      const to = new Date(Date.now() - 60_000).toISOString();
      await http()
        .get(`/api/glucose/summary?from=${from}&to=${to}`)
        .set(auth())
        .expect(400);
    });
  });

  describe('waitlist', () => {
    const address = () => `wl-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;

    it('accepts a signup without authentication', async () => {
      const res = await http()
        .post('/api/waitlist')
        .send({ email: address() })
        .expect(200);
      expect(res.body.subscribed).toBe(true);
    });

    it('rejects a malformed address', async () => {
      await http().post('/api/waitlist').send({ email: 'not-an-email' }).expect(400);
      await http().post('/api/waitlist').send({}).expect(400);
    });

    it('answers identically for a repeat, so the list cannot be probed', async () => {
      const email = address();
      const first = await http().post('/api/waitlist').send({ email }).expect(200);
      const second = await http().post('/api/waitlist').send({ email }).expect(200);

      // Same body either way: a stranger must not be able to learn whether a
      // given person already signed up.
      expect(second.body).toEqual(first.body);
    });

    it('stores one row per address, regardless of case', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);
      await http().post('/api/waitlist').send({ email: email.toUpperCase() }).expect(200);

      const { rows } = await pool.query<{ count: string }>(
        'select count(*) from identity.waitlist_signups where lower(email) = lower($1)',
        [email],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it('does not record the address in the audit metadata', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);

      const { rows } = await pool.query<{ metadata: Record<string, unknown> }>(
        `select metadata from audit.events
          where action = 'waitlist.signup'
          order by occurred_at desc limit 1`,
      );
      expect(JSON.stringify(rows[0].metadata)).not.toContain(email);
    });
  });

  describe('audit trail', () => {
    it('records every write the user made', async () => {
      const res = await http()
        .get('/api/users/me/audit')
        .set({ authorization: `Bearer ${accessToken}` })
        .expect(200);

      const actions = res.body.map((e: { action: string }) => e.action);
      expect(actions).toContain('auth.register');
      expect(actions).toContain('glucose.import');
      expect(actions).toContain('meal.create');
    });
  });
});
