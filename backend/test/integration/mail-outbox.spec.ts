import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { testClientConfig } from './helpers';
import type { MailService } from '../../src/notifications/mail.service';
import type { MailWorker } from '../../src/notifications/mail.worker';

/**
 * The outbox, against a real database and a stubbed Microsoft Graph.
 *
 * Its own file, and its own application, because it is the one suite that runs
 * with MAIL_DRY_RUN off: everything here is about what the worker does with
 * the provider's answer, and dry run never asks the provider anything. Vitest
 * isolates modules per file, so setting the environment before AppModule is
 * imported gives this app its own configuration.
 *
 * Graph is stubbed rather than reached. What matters here is the state machine
 * — claimed, retried, given up on, erased — and a real provider would make
 * these tests slow, flaky, and dependent on somebody's tenant.
 */
describe('the mail outbox', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let db: Client;
  let mail: MailService;
  let worker: MailWorker;

  const MAX_ATTEMPTS = 2;

  beforeAll(async () => {
    process.env.MAIL_ENABLED = 'true';
    process.env.MAIL_DRY_RUN = 'false';
    process.env.MAIL_MAX_ATTEMPTS = String(MAX_ATTEMPTS);
    process.env.MAIL_PER_RECIPIENT_LIMIT = '2';
    process.env.MAIL_PER_RECIPIENT_WINDOW_S = '3600';
    // Nothing on a timer: every pass in this file is driven deliberately, so
    // an assertion never races a background one.
    process.env.MAIL_WORKER_INTERVAL_MS = '3600000';
    // Large enough that a pass reaches the row this test queued even with
    // whatever earlier suites left in the table.
    process.env.MAIL_WORKER_BATCH = '200';
    process.env.GRAPH_TENANT_ID = 'tenant-id';
    process.env.GRAPH_CLIENT_ID = 'client-id';
    process.env.GRAPH_CLIENT_SECRET = 'client-secret';
    process.env.GRAPH_SENDER_USER = 'support@wellovue.test';
    process.env.APP_PUBLIC_URL = 'http://localhost:3000';

    const { AppModule } = await import('../../src/app.module');
    const { MailService: Service } = await import('../../src/notifications/mail.service');
    const { MailWorker: Worker } = await import('../../src/notifications/mail.worker');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = () => request(app.getHttpServer());

    mail = app.get(Service);
    worker = app.get(Worker);

    db = new Client(testClientConfig());
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
    await app?.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Graph: a token, then whatever the sendMail call should answer with. */
  function graphAnswers(send: () => Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('oauth2/v2.0/token')
          ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : send(),
      ),
    );
  }

  const address = (label: string) =>
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;

  async function row(id: string) {
    const { rows } = await db.query(
      `select status, attempt_count, last_error, sent_at, payload, provider,
              next_attempt_at > now() as backing_off
         from notify.mail_outbox where id = $1`,
      [id],
    );
    return rows[0] as {
      status: string;
      attempt_count: number;
      last_error: string | null;
      sent_at: Date | null;
      payload: Record<string, unknown>;
      provider: string;
      backing_off: boolean;
    };
  }

  /** Queues one verification message and returns its outbox id. */
  async function queueOne(to: string, dedupeKey?: string) {
    const outcome = await mail.queue({
      template: 'email_verification',
      to,
      userId: null,
      vars: {
        verifyUrl: 'http://localhost:3000/verify-email?token=a-secret-token-value',
        expiresIn: '24 hours',
      },
      dedupeKey,
    });
    return outcome;
  }

  it('marks a row sent when Graph accepts it, and erases the token', async () => {
    graphAnswers(() => new Response(null, { status: 202 }));

    const { id } = await queueOne(address('accepted'));
    await worker.pass();

    const after = await row(id!);
    // `sent` means Graph took it. It is not a delivery receipt, and nothing
    // downstream should read it as one — Graph returns 202 with no body.
    expect(after.status).toBe('sent');
    expect(after.sent_at).not.toBeNull();
    expect(after.provider).toBe('microsoft_graph');
    // The one place a live token sat in the database is now empty.
    expect(after.payload).toEqual({});
  });

  it('puts a throttled row back in the queue, with the error kept safely', async () => {
    graphAnswers(
      () =>
        new Response(JSON.stringify({ error: { code: 'ApplicationThrottled' } }), {
          status: 429,
          headers: { 'retry-after': '30', 'content-type': 'application/json' },
        }),
    );

    const { id } = await queueOne(address('throttled'));
    await worker.pass();

    const after = await row(id!);
    expect(after.status).toBe('queued');
    expect(after.attempt_count).toBe(1);
    expect(after.backing_off).toBe(true);
    expect(after.last_error).toContain('ApplicationThrottled');
    // The failure is recorded without the message it was carrying.
    expect(after.last_error).not.toContain('a-secret-token-value');
  });

  it('gives up immediately on a failure that retrying cannot fix', async () => {
    graphAnswers(
      () =>
        new Response(JSON.stringify({ error: { code: 'ErrorAccessDenied' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const { id } = await queueOne(address('denied'));
    await worker.pass();

    const after = await row(id!);
    // Mail.Send unconsented will be just as unconsented in five minutes, and
    // the queue behind this row is real mail.
    expect(after.status).toBe('failed');
    expect(after.attempt_count).toBe(1);
    expect(after.payload).toEqual({});
  });

  it('stops retrying a transient failure eventually', async () => {
    graphAnswers(() => new Response(null, { status: 503 }));

    const { id } = await queueOne(address('unavailable'));

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // The backoff is real, so the row is brought forward rather than waited
      // out. What is under test is the attempt ceiling, not the clock.
      await db.query('update notify.mail_outbox set next_attempt_at = now() where id = $1', [id]);
      await worker.pass();
    }

    const after = await row(id!);
    expect(after.attempt_count).toBe(MAX_ATTEMPTS);
    // A provider that is simply down must not have one row retried forever
    // while the queue behind it grows.
    expect(after.status).toBe('failed');
  });

  it('refuses to queue the same message twice', async () => {
    graphAnswers(() => new Response(null, { status: 202 }));

    const to = address('deduped');
    const key = `test-dedupe:${to}`;

    const first = await queueOne(to, key);
    const second = await queueOne(to, key);

    expect(first.queued).toBe(true);
    expect(second).toEqual({ queued: false, reason: 'duplicate' });

    const { rows } = await db.query(
      'select count(*)::int as n from notify.mail_outbox where dedupe_key = $1',
      [key],
    );
    // Enforced by a unique index rather than by a service remembering to
    // check, which is what makes it hold across replicas.
    expect(rows[0].n).toBe(1);
  });

  it('stops mailing one address past its share', async () => {
    const to = address('flooded');

    await queueOne(to);
    await queueOne(to);
    const third = await queueOne(to);

    expect(third).toEqual({ queued: false, reason: 'rate_limited' });

    const { rows } = await db.query(
      `select status, last_error from notify.mail_outbox
        where lower(recipient_email) = lower($1) order by created_at`,
      [to],
    );
    // The refusal is recorded rather than silent: "why did they not get the
    // email" needs an answer that is not "read the logs".
    expect(rows.map((r) => r.status)).toEqual(['queued', 'queued', 'skipped']);
    expect(rows[2].last_error).toContain('rate limit');
  });

  it('tells somebody when a new device signs in', async () => {
    graphAnswers(() => new Response(null, { status: 202 }));

    const email = address('device');
    const password = 'a-very-long-test-password';
    await http().post('/api/auth/register').send({ email, password }).expect(201);

    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';

    await http()
      .post('/api/auth/login')
      .set('user-agent', chrome)
      .send({ email, password })
      .expect(200);

    const afterFirst = await templatesFor(email);
    // The first device an account ever signs in from is recorded silently. A
    // "new sign-in" notice for the browser the person is looking at, seconds
    // after the verification email, is how people learn these are noise.
    expect(afterFirst).not.toContain('new_device_sign_in.v1');

    await http()
      .post('/api/auth/login')
      .set('user-agent', firefox)
      .send({ email, password })
      .expect(200);

    expect(await templatesFor(email)).toContain('new_device_sign_in.v1');

    // Same browser again: recognised, so no second notice.
    await http()
      .post('/api/auth/login')
      .set('user-agent', firefox)
      .send({ email, password })
      .expect(200);

    const notices = (await templatesFor(email)).filter(
      (t) => t === 'new_device_sign_in.v1',
    );
    expect(notices).toHaveLength(1);
  });

  it('does not fail a sign-in when mail cannot be sent', async () => {
    // A courtesy notification must never be able to stop somebody signing in.
    // The mail path is exercised with the provider refusing everything.
    graphAnswers(() => new Response(null, { status: 500 }));

    const email = address('signin-resilient');
    const password = 'a-very-long-test-password';
    await http().post('/api/auth/register').send({ email, password }).expect(201);

    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36';
    await http().post('/api/auth/login').set('user-agent', ua).send({ email, password }).expect(200);
    await http()
      .post('/api/auth/login')
      .set('user-agent', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0')
      .send({ email, password })
      .expect(200);

    await worker.pass();
  });

  async function templatesFor(email: string): Promise<string[]> {
    const { rows } = await db.query<{ template: string }>(
      `select template from notify.mail_outbox
        where lower(recipient_email) = lower($1) order by created_at`,
      [email],
    );
    return rows.map((r) => r.template);
  }
});
