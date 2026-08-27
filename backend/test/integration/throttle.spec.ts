import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Rate limiting, exercised through the real guard stack.
 *
 * Its own file with its own app, because the limits have to be small enough to
 * reach and that would throttle every other suite. Vitest isolates modules per
 * file, so setting the environment here before AppModule is imported gives
 * this app its own configuration and its own counter storage.
 */
describe('rate limiting', () => {
  let app: INestApplication;
  let http: () => request.Agent;

  const AUTH_LIMIT = 3;
  const WRITE_LIMIT = 2;

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = String(AUTH_LIMIT);
    process.env.THROTTLE_AUTH_TTL_S = '900';
    process.env.THROTTLE_WRITE_LIMIT = String(WRITE_LIMIT);
    process.env.THROTTLE_WRITE_TTL_S = '3600';
    process.env.THROTTLE_GLOBAL_LIMIT = '100000';

    // Imported after the environment is set: the config is validated and
    // cached the first time it is read.
    const { AppModule } = await import('../../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  const login = (email: string) =>
    http().post('/api/auth/login').send({ email, password: 'wrong-password-entirely' });

  it('stops a brute-force run against one account', async () => {
    const email = `victim-${Date.now()}@test.local`;

    for (let attempt = 0; attempt < AUTH_LIMIT; attempt += 1) {
      const res = await login(email);
      // Wrong password, so 401 — the point is that it was allowed through.
      expect(res.status).toBe(401);
    }

    const blocked = await login(email);
    expect(blocked.status).toBe(429);
    // The message must not confirm whether the account exists or say how many
    // attempts remain.
    expect(JSON.stringify(blocked.body)).not.toContain(email);
  });

  it('counts per account, so one victim being locked does not lock everyone', async () => {
    const first = `alice-${Date.now()}@test.local`;
    const second = `bob-${Date.now()}@test.local`;

    for (let attempt = 0; attempt < AUTH_LIMIT; attempt += 1) await login(first);
    expect((await login(first)).status).toBe(429);

    // Same source address, different account: still allowed. This is what
    // makes the limit survive credential stuffing without locking the world
    // out the moment one account is targeted.
    expect((await login(second)).status).toBe(401);
  });

  it('throttles the unauthenticated write endpoints', async () => {
    const body = () => ({
      email: `spam-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`,
    });

    for (let attempt = 0; attempt < WRITE_LIMIT; attempt += 1) {
      const res = await http().post('/api/waitlist').send(body());
      expect(res.status).toBeLessThan(400);
    }

    const blocked = await http().post('/api/waitlist').send(body());
    expect(blocked.status).toBe(429);
  });

  it('keeps a tight named limit off the routes that did not ask for it', async () => {
    // The regression this file exists for. Every configured throttler is
    // evaluated against every route unless the guard drops it, so the
    // five-per-hour limit written for the waitlist form governed the entire
    // API for a while: the timeline would have started returning 429 to
    // ordinary use, and only real users would have found out.
    //
    // Unauthenticated here on purpose. 401 proves the request reached the
    // auth guard, which is past the throttler; 429 would mean it did not.
    for (let attempt = 0; attempt < WRITE_LIMIT + 4; attempt += 1) {
      const res = await http().get('/api/timeline');
      expect(res.status).toBe(401);
    }
  });

  it('never throttles the health probes', async () => {
    // Containers poll these every ten seconds from the same address as
    // everything else behind the proxy. Counting them would spend the budget
    // on ourselves and take the service down for being alive.
    for (let attempt = 0; attempt < WRITE_LIMIT + 5; attempt += 1) {
      await http().get('/api/health/live').expect(200);
    }
  });
});
