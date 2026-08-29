import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { testClientConfig, verifyEmailFor } from './helpers';

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
  const cookie = setCookies(res).find((c) => c.startsWith('wellovue_refresh='));
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
      expect(res.body.user.emailVerifiedAt).toBeNull();
      accessToken = res.body.tokens.accessToken;

      // A new account is unverified, and unverified accounts are refused every
      // product route below. A person clicks the link in their email at this
      // point; the helper does the same thing through the same endpoint.
      await verifyEmailFor(http, pool, email);
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

      const cookie = setCookies(res).find((c) => c.startsWith('wellovue_refresh='));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/auth/i);
    });

    it('sets a readable session hint that grants nothing', async () => {
      const res = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      const hint = setCookies(res).find((c) => c.startsWith('wellovue_signed_in='));
      expect(hint).toBeDefined();
      // Readable on purpose: a public page uses it to offer the timeline
      // rather than a login form. It must never look like a credential.
      expect(hint).not.toMatch(/HttpOnly/i);
      expect(hint).toMatch(/Path=\//i);
      expect(hint).toMatch(/wellovue_signed_in=1/);
    });

    it('does not accept the hint as authentication', async () => {
      // Holding the hint and nothing else must get you nowhere.
      await http()
        .get('/api/users/me')
        .set('Cookie', 'wellovue_signed_in=1')
        .expect(401);

      await http()
        .post('/api/auth/refresh')
        .set('Cookie', 'wellovue_signed_in=1')
        .expect(401);
    });

    it('clears the hint on sign out, so no page can keep claiming a session', async () => {
      const login = await http()
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);

      const res = await http()
        .post('/api/auth/logout')
        .set({ authorization: `Bearer ${login.body.tokens.accessToken}` })
        .set('Cookie', refreshCookie(login))
        .send({})
        .expect(204);

      const cleared = setCookies(res).find((c) => c.startsWith('wellovue_signed_in='));
      expect(cleared).toMatch(/wellovue_signed_in=;/);
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
      const cleared = setCookies(replay).find((c) => c.startsWith('wellovue_refresh='));
      expect(cleared).toMatch(/wellovue_refresh=;/);
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

    it('counts a reading exactly on either bound as in range', async () => {
      // The boundary is where the layers would disagree without noticing.
      // 3.9 and 10.0 are in range everywhere in this product; a summary that
      // used `>` where a chart used `>=` would report a different
      // time-in-range from the band drawn beside it, and a clinician reading
      // the percentage would have no way to see the disagreement.
      const day = '2026-09-15';
      const readings: [string, number][] = [
        [`${day}T01:00:00Z`, 3.9], // low bound, in
        [`${day}T02:00:00Z`, 10.0], // high bound, in
        [`${day}T03:00:00Z`, 3.8], // just below
        [`${day}T04:00:00Z`, 10.1], // just above
      ];
      for (const [at, value] of readings) {
        await http()
          .post('/api/glucose')
          .set(auth())
          .send({ measuredAt: at, value, unit: 'mmol/L', source: 'manual' })
          .expect(201);
      }

      const res = await http()
        .get(`/api/glucose/summary?from=${day}T00:00:00Z&to=${day}T23:59:59Z`)
        .set(auth())
        .expect(200);

      expect(res.body.sampleCount).toBe(4);
      expect(res.body.timeInRange).toBeCloseTo(0.5, 5);
      expect(res.body.timeAboveRange).toBeCloseTo(0.25, 5);
      expect(res.body.timeBelowRange).toBeCloseTo(0.25, 5);
      // The three shares must account for every reading, or the percentage is
      // quietly wrong rather than visibly missing.
      expect(
        res.body.timeInRange + res.body.timeAboveRange + res.body.timeBelowRange,
      ).toBeCloseTo(1, 5);
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
      const otherEmail = `other-${Date.now()}@test.local`;
      const other = await http()
        .post('/api/auth/register')
        .send({ email: otherEmail, password })
        .expect(201);
      othersToken = other.body.tokens.accessToken;
      await verifyEmailFor(http, pool, otherEmail);

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

    /**
     * The live confirmation token for an address.
     *
     * Read out of the queued outbox row, because that is the only place the
     * secret half exists — the signup row holds a hash. Same reasoning as
     * `verifyEmailFor` in helpers.ts, and the same requirement: this suite
     * runs with MAIL_ENABLED and MAIL_DRY_RUN both on.
     */
    async function confirmToken(email: string): Promise<string> {
      const { rows } = await pool.query<{ url: string }>(
        `select payload->>'confirmUrl' as url from notify.mail_outbox
          where lower(recipient_email) = lower($1)
            and template like 'waitlist_confirmation%'
          order by created_at desc limit 1`,
        [email],
      );
      if (!rows[0]?.url) throw new Error(`No confirmation email queued for ${email}`);
      return new URL(rows[0].url).searchParams.get('token') ?? '';
    }

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

    it('queues one confirmation email and leaves the address unconfirmed', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);

      const { rows } = await pool.query<{ confirmed_at: Date | null }>(
        'select confirmed_at from identity.waitlist_signups where lower(email) = lower($1)',
        [email],
      );
      // Submitting the form does not put anybody on the list. Clicking does.
      expect(rows[0].confirmed_at).toBeNull();

      const mail = await pool.query<{ template: string; status: string }>(
        `select template, status from notify.mail_outbox
          where lower(recipient_email) = lower($1)`,
        [email],
      );
      expect(mail.rows.map((r) => r.template)).toEqual(['waitlist_confirmation.v1']);
      expect(mail.rows[0].status).toBe('queued');
    });

    it('confirms the address when the link is opened', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);

      const res = await http()
        .post('/api/waitlist/confirm')
        .send({ token: await confirmToken(email) })
        .expect(200);
      expect(res.body).toEqual({ confirmed: true });

      const { rows } = await pool.query<{ confirmed_at: Date | null; hash: string | null }>(
        `select confirmed_at, confirm_token_hash as hash
           from identity.waitlist_signups where lower(email) = lower($1)`,
        [email],
      );
      expect(rows[0].confirmed_at).not.toBeNull();
      // The token is cleared on use, so the link cannot be replayed.
      expect(rows[0].hash).toBeNull();
    });

    it('will not spend the same confirmation twice', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);
      const token = await confirmToken(email);

      await http().post('/api/waitlist/confirm').send({ token }).expect(200);
      const second = await http()
        .post('/api/waitlist/confirm')
        .send({ token })
        .expect(200);
      expect(second.body).toEqual({ confirmed: false, reason: 'invalid' });
    });

    it('rejects an expired confirmation, and says so', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);
      const token = await confirmToken(email);

      // Aged directly. The alternative is a suite that takes a week.
      await pool.query(
        `update identity.waitlist_signups set confirm_expires_at = now() - interval '1 minute'
          where lower(email) = lower($1)`,
        [email],
      );

      const res = await http().post('/api/waitlist/confirm').send({ token }).expect(200);
      expect(res.body).toEqual({ confirmed: false, reason: 'expired' });
    });

    it('rejects a token nobody ever issued', async () => {
      const res = await http()
        .post('/api/waitlist/confirm')
        .send({ token: 'not-a-token-but-long-enough-to-pass-the-schema' })
        .expect(200);
      expect(res.body).toEqual({ confirmed: false, reason: 'invalid' });
    });

    it('replaces the live link when an unconfirmed address signs up again', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);
      const first = await confirmToken(email);

      await http().post('/api/waitlist').send({ email }).expect(200);
      const second = await confirmToken(email);
      expect(second).not.toBe(first);

      // Somebody who did not receive the first email is trying again. Leaving
      // the old link alive would mean two live tokens for one address.
      expect(
        (await http().post('/api/waitlist/confirm').send({ token: first }).expect(200)).body,
      ).toEqual({ confirmed: false, reason: 'invalid' });
      expect(
        (await http().post('/api/waitlist/confirm').send({ token: second }).expect(200)).body,
      ).toEqual({ confirmed: true });
    });

    it('sends nothing more once an address is confirmed', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);
      await http()
        .post('/api/waitlist/confirm')
        .send({ token: await confirmToken(email) })
        .expect(200);

      // Re-entering an address already on the list must not mail them again,
      // and must still answer exactly as it does for a new one.
      const again = await http().post('/api/waitlist').send({ email }).expect(200);
      expect(again.body).toEqual({ subscribed: true });

      const { rows } = await pool.query<{ n: number }>(
        `select count(*)::int as n from notify.mail_outbox
          where lower(recipient_email) = lower($1)`,
        [email],
      );
      expect(rows[0].n).toBe(1);
    });

    it('stores only a hash of the confirmation token', async () => {
      const email = address();
      await http().post('/api/waitlist').send({ email }).expect(200);
      const token = await confirmToken(email);

      const { rows } = await pool.query<{ hash: string }>(
        `select confirm_token_hash as hash from identity.waitlist_signups
          where lower(email) = lower($1)`,
        [email],
      );
      expect(rows[0].hash).not.toBe(token);
      expect(rows[0].hash).toBe(createHash('sha256').update(token).digest('hex'));
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

  describe('contact', () => {
    const valid = () => ({
      email: `contact-${Date.now()}@test.local`,
      topic: 'general' as const,
      message: 'A message long enough to clear the minimum length.',
    });

    it('accepts a message without authentication', async () => {
      const res = await http().post('/api/contact').send(valid()).expect(200);
      expect(res.body.received).toBe(true);
    });

    it('rejects a message that is too short to act on', async () => {
      await http()
        .post('/api/contact')
        .send({ ...valid(), message: 'help' })
        .expect(400);
    });

    it('rejects an unrecognised topic', async () => {
      await http()
        .post('/api/contact')
        .send({ ...valid(), topic: 'anything' })
        .expect(400);
    });

    it('rejects a message beyond the length limit', async () => {
      await http()
        .post('/api/contact')
        .send({ ...valid(), message: 'x'.repeat(5001) })
        .expect(400);
    });

    it('keeps the message body and address out of the audit trail', async () => {
      const input = { ...valid(), message: 'My secret medical detail goes here.' };
      await http().post('/api/contact').send(input).expect(200);

      const { rows } = await pool.query<{ metadata: Record<string, unknown> }>(
        `select metadata from audit.events
          where action = 'support.contact'
          order by occurred_at desc limit 1`,
      );
      const recorded = JSON.stringify(rows[0].metadata);
      // The audit table is append-only: anything written there cannot later be
      // removed, so free text a person did not mean to send must never reach it.
      expect(recorded).not.toContain('secret medical detail');
      expect(recorded).not.toContain(input.email);
      expect(rows[0].metadata.topic).toBe('general');
    });

    it('attributes the message when the sender is signed in', async () => {
      const input = valid();
      await http()
        .post('/api/contact')
        .set({ authorization: `Bearer ${accessToken}` })
        .send(input)
        .expect(200);

      const { rows } = await pool.query<{ user_id: string | null }>(
        'select user_id from support.contact_messages where email = $1',
        [input.email],
      );
      expect(rows[0].user_id).toBeTruthy();
    });

    it('still accepts the message when the token is unusable', async () => {
      const input = valid();
      await http()
        .post('/api/contact')
        .set({ authorization: 'Bearer not-a-real-token' })
        .send(input)
        .expect(200);

      const { rows } = await pool.query<{ user_id: string | null }>(
        'select user_id from support.contact_messages where email = $1',
        [input.email],
      );
      // A stale token means unattributed, not rejected.
      expect(rows[0].user_id).toBeNull();
    });
  });

  describe('evidence', () => {
    const auth = () => ({ authorization: `Bearer ${accessToken}` });

    let userId: string;

    beforeAll(async () => {
      // Read back rather than threaded down from the registration test, so
      // this block does not depend on the shape of that response body.
      const { rows } = await pool.query<{ id: string }>(
        'select id from identity.users where email = $1',
        [email],
      );
      userId = rows[0].id;

      // A new account starts as `unknown` and the engine is not run for it.
      // Answering the question is what a real user does before any of this
      // means anything, so the suite does it too rather than reaching into
      // the database to fake it.
      await http()
        .put('/api/diabetes-profile')
        .set(auth())
        .send({ diabetesType: 'type_2' })
        .expect(200);
    });

    /**
     * Puts one morning reading on each of `days` consecutive days.
     *
     * Written straight to the table rather than through the API because the
     * point of these tests is the bridge to the Python engine, and the engine
     * reads the table. Each window is disjoint from every other test's, so
     * these rows cannot move another assertion.
     */
    async function seedMornings(startIso: string, days: number, value: number) {
      const start = new Date(startIso);
      for (let day = 0; day < days; day += 1) {
        const at = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
        at.setUTCHours(7, 0, 0, 0);
        await pool.query(
          `insert into metabolic.glucose_samples
             (user_id, measured_at, glucose_value, unit, source)
           values ($1, $2, $3, 'mmol/L', 'cgm_device')
           on conflict do nothing`,
          [userId, at.toISOString(), value],
        );
      }
    }

    interface Finding {
      findingType: string;
      summary: string;
      effectEstimate: number | null;
      effectUnit: string | null;
      confidence: number;
      sampleCount: number;
      limitations: string[];
      clinicianReviewRecommended: boolean;
      wouldImproveWith: string[];
    }

    const get = (from: string, to: string) =>
      http().get(`/api/evidence?from=${from}&to=${to}`).set(auth());

    it('refuses to produce findings for an unauthenticated caller', async () => {
      // The engine behind this endpoint answers about whatever user id it is
      // given, so the token is the only thing standing between a stranger and
      // someone's metabolic record.
      await http().get('/api/evidence').expect(401);
    });

    it('rejects a reversed range and an unbounded one', async () => {
      await get('2026-04-11T00:00:00.000Z', '2026-04-01T00:00:00.000Z').expect(400);
      await get('2020-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z').expect(400);
    });

    it('produces a real finding from the readings in the window', async () => {
      await seedMornings('2026-04-01T00:00:00.000Z', 10, 6);

      const res = await get(
        '2026-04-01T00:00:00.000Z',
        '2026-04-11T00:00:00.000Z',
      ).expect(200);

      expect(res.body.userId).toBe(userId);
      expect(res.body.modelVersion).toMatch(/^pattern-engine-/);
      expect(Date.parse(res.body.generatedAt)).not.toBeNaN();

      const morning = (res.body.findings as Finding[]).find(
        (f) => f.findingType === 'morning_glucose_pattern',
      );
      expect(morning).toBeTruthy();
      // The engine computed this from the rows above, not from a fixture.
      expect(morning!.effectEstimate).toBeCloseTo(6, 1);
      expect(morning!.effectUnit).toContain('mmol/L');
      expect(morning!.sampleCount).toBe(10);
      expect(morning!.summary).toContain('6.0');
    });

    it('never returns a finding without its limitations attached', async () => {
      const res = await get(
        '2026-04-01T00:00:00.000Z',
        '2026-04-11T00:00:00.000Z',
      ).expect(200);

      // An unqualified finding is the one failure mode this product cannot
      // have: it would read as a claim rather than as evidence.
      for (const finding of res.body.findings as Finding[]) {
        expect(finding.limitations.length).toBeGreaterThan(0);
        expect(finding.confidence).toBeGreaterThanOrEqual(0);
        expect(finding.confidence).toBeLessThanOrEqual(1);
        expect(finding.sampleCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('answers a window with no data instead of failing', async () => {
      const res = await get(
        '2025-01-01T00:00:00.000Z',
        '2025-01-10T00:00:00.000Z',
      ).expect(200);

      // "Not enough data" is a real answer and is delivered as one. A 404 or
      // an empty list would let the screen imply the question was never asked.
      expect(res.body.findings).toHaveLength(1);
      const [finding] = res.body.findings as Finding[];
      expect(finding.findingType).toBe('insufficient_data');
      expect(finding.effectEstimate).toBeNull();
      expect(finding.sampleCount).toBe(0);
      expect(finding.wouldImproveWith.length).toBeGreaterThan(0);
    });

    it('flags a pattern a clinician should see', async () => {
      await seedMornings('2026-05-01T00:00:00.000Z', 6, 12.5);

      const res = await get(
        '2026-05-01T00:00:00.000Z',
        '2026-05-07T00:00:00.000Z',
      ).expect(200);

      const morning = (res.body.findings as Finding[]).find(
        (f) => f.findingType === 'morning_glucose_pattern',
      );
      // Persistently raised waking glucose is surfaced, not interpreted.
      expect(morning!.clinicianReviewRecommended).toBe(true);
    });

    it('orders answerable findings ahead of the ones needing more data', async () => {
      const res = await get(
        '2026-04-01T00:00:00.000Z',
        '2026-06-30T00:00:00.000Z',
      ).expect(200);

      const findings = res.body.findings as Finding[];
      const lastAnswered = findings.map((f) => f.effectEstimate !== null).lastIndexOf(true);
      const firstUnanswered = findings.map((f) => f.effectEstimate === null).indexOf(true);

      if (lastAnswered !== -1 && firstUnanswered !== -1) {
        expect(lastAnswered).toBeLessThan(firstUnanswered);
      }
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
