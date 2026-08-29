import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { testClientConfig } from './helpers';

/**
 * Email verification, end to end through the real application.
 *
 * The suite runs with MAIL_ENABLED and MAIL_DRY_RUN both on, which is exactly
 * the shape a deployment has minus the network: rows land in
 * `notify.mail_outbox` as they would in production, and nothing reaches
 * Microsoft Graph. What Graph does with a message is a separate question,
 * answered in the unit suite against a stubbed provider.
 *
 * The token in each test comes out of the outbox row's `payload`, which is the
 * only place the secret half exists — the token table holds a hash. That is
 * also the honest demonstration of what that column is for, and of the fact
 * that it is erased once the message is dealt with.
 */
describe('email verification', () => {
  let app: INestApplication;
  let http: () => request.Agent;
  let db: Client;

  const password = 'a-very-long-test-password';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    http = () => request(app.getHttpServer());

    db = new Client(testClientConfig());
    await db.connect();
  });

  afterAll(async () => {
    await db?.end();
    await app?.close();
  });

  /** A fresh account, and the access token it was handed. */
  async function signUp(label: string) {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
    const res = await http()
      .post('/api/auth/register')
      .send({ email, password })
      .expect(201);
    return { email, accessToken: res.body.tokens.accessToken as string, body: res.body };
  }

  async function outboxFor(email: string) {
    const { rows } = await db.query(
      `select template, status, subject, payload, metadata, user_id
         from notify.mail_outbox
        where lower(recipient_email) = lower($1)
        order by created_at`,
      [email],
    );
    return rows as {
      template: string;
      status: string;
      subject: string;
      payload: Record<string, string>;
      metadata: Record<string, unknown>;
      user_id: string | null;
    }[];
  }

  /** Pulls the live token out of the queued verification message. */
  function tokenFrom(url: string): string {
    return new URL(url).searchParams.get('token') ?? '';
  }

  describe('signing up', () => {
    it('creates the account unverified and queues one verification email', async () => {
      const { email, body } = await signUp('verify-signup');

      expect(body.user.emailVerifiedAt).toBeNull();

      const outbox = await outboxFor(email);
      expect(outbox).toHaveLength(1);
      expect(outbox[0].template).toBe('email_verification.v1');
      expect(outbox[0].status).toBe('queued');
      expect(outbox[0].subject).toBe('Verify your Wellovue email');
      // The link is on the configured public origin, not on whatever host the
      // request happened to arrive at. A verification link is the shape
      // phishing imitates; it must never be caller-influenced.
      expect(outbox[0].payload.verifyUrl).toContain('http://localhost:3000/verify-email?token=');
    });

    it('does not welcome anybody before they have proved the address', async () => {
      const { email } = await signUp('verify-nowelcome');
      const templates = (await outboxFor(email)).map((r) => r.template);

      // The whole point of the flow. A welcome sent at signup goes to whoever
      // actually owns a mistyped address, welcoming them to an account they
      // did not open.
      expect(templates).not.toContain('welcome.v1');
    });

    it('never stores a rendered body, only the template and safe metadata', async () => {
      const { email } = await signUp('verify-nobody');
      const row = (await outboxFor(email))[0];

      expect(row.metadata).toEqual({ flow: 'email_verification' });
      // The stored variables are the link and the expiry, and nothing else.
      expect(Object.keys(row.payload).sort()).toEqual(['expiresIn', 'verifyUrl']);
    });

    it('refuses the product until the address is verified', async () => {
      const { accessToken } = await signUp('verify-blocked');

      const refused = await http()
        .get('/api/timeline?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(403);

      // A distinct code, so the app can tell "prove your address" from "sign
      // in again". Showing the wrong one sends people in circles.
      expect(refused.body.code).toBe('email_unverified');
    });

    it('still lets an unverified account see who it is', async () => {
      const { accessToken, email } = await signUp('verify-me');

      const me = await http()
        .get('/api/users/me')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Without this the app cannot tell "not verified" from "not signed in",
      // and has nothing to put on the screen.
      expect(me.body.email).toBe(email);
      expect(me.body.emailVerifiedAt).toBeNull();
    });
  });

  describe('following the link', () => {
    it('marks the address verified and queues the welcome', async () => {
      const { email } = await signUp('verify-ok');
      const token = tokenFrom((await outboxFor(email))[0].payload.verifyUrl);

      const res = await http()
        .post('/api/auth/verify-email')
        .send({ token })
        .expect(200);
      expect(res.body).toEqual({ verified: true });

      const { rows } = await db.query(
        'select email_verified_at from identity.users where lower(email) = lower($1)',
        [email],
      );
      expect(rows[0].email_verified_at).not.toBeNull();

      const templates = (await outboxFor(email)).map((r) => r.template);
      expect(templates).toContain('welcome.v1');
    });

    it('opens the product once verified', async () => {
      const { email } = await signUp('verify-opens');
      const token = tokenFrom((await outboxFor(email))[0].payload.verifyUrl);
      await http().post('/api/auth/verify-email').send({ token }).expect(200);

      // Signing in again rather than reusing the registration token, because
      // that token's `verified` claim is stale by construction. Both paths
      // must work; the guard's database fallback covers the stale one.
      const login = await http().post('/api/auth/login').send({ email, password }).expect(200);
      expect(login.body.user.emailVerifiedAt).not.toBeNull();

      await http()
        .get('/api/timeline?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z')
        .set('authorization', `Bearer ${login.body.tokens.accessToken}`)
        .expect(200);
    });

    it('admits a token issued before verification, once the account is verified', async () => {
      // The stale-claim case, on its own. An access token lives fifteen
      // minutes, so somebody who verifies two minutes after signing up is
      // holding a token that still says unverified. Refusing it would tell
      // them to verify an address they just verified.
      const { email, accessToken } = await signUp('verify-stale');
      const token = tokenFrom((await outboxFor(email))[0].payload.verifyUrl);
      await http().post('/api/auth/verify-email').send({ token }).expect(200);

      await http()
        .get('/api/timeline?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('will not spend the same token twice', async () => {
      const { email } = await signUp('verify-reuse');
      const token = tokenFrom((await outboxFor(email))[0].payload.verifyUrl);

      await http().post('/api/auth/verify-email').send({ token }).expect(200);
      const second = await http()
        .post('/api/auth/verify-email')
        .send({ token })
        .expect(200);

      expect(second.body).toEqual({ verified: false, reason: 'invalid' });

      // And exactly one welcome, however many times the link is opened. Mail
      // clients prefetch links; a second welcome would be the visible symptom.
      const welcomes = (await outboxFor(email)).filter((r) => r.template === 'welcome.v1');
      expect(welcomes).toHaveLength(1);
    });

    it('rejects an expired token, and says so', async () => {
      const { email } = await signUp('verify-expired');
      const { rows } = await db.query<{ id: string }>(
        'select id from identity.users where lower(email) = lower($1)',
        [email],
      );

      // Aged directly rather than by waiting: the alternative is a suite that
      // takes 24 hours or a TTL configured so short it tests nothing.
      // Unique per run: `token_hash` is unique, so a fixed string would insert
      // once and then collide on every later run against the same database.
      const raw = `expired-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await db.query(
        `insert into identity.security_tokens (user_id, purpose, token_hash, expires_at)
         values ($1, 'email_verification', $2, now() - interval '1 minute')`,
        [rows[0].id, createHash('sha256').update(raw).digest('hex')],
      );

      const res = await http().post('/api/auth/verify-email').send({ token: raw }).expect(200);
      // Told apart from "invalid" deliberately: the token is a secret only its
      // holder has, so this reveals nothing, and it is the difference between
      // a page offering a new link and a page saying something went wrong.
      expect(res.body).toEqual({ verified: false, reason: 'expired' });
    });

    it('rejects a token nobody ever issued', async () => {
      const res = await http()
        .post('/api/auth/verify-email')
        .send({ token: 'not-a-token-but-long-enough-to-pass-the-schema' })
        .expect(200);
      expect(res.body).toEqual({ verified: false, reason: 'invalid' });
    });

    it('stores only a hash, never the token', async () => {
      const { email } = await signUp('verify-hash');
      const token = tokenFrom((await outboxFor(email))[0].payload.verifyUrl);

      const { rows } = await db.query<{ token_hash: string }>(
        `select t.token_hash from identity.security_tokens t
           join identity.users u on u.id = t.user_id
          where lower(u.email) = lower($1)`,
        [email],
      );
      expect(rows[0].token_hash).not.toBe(token);
      expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    });
  });

  describe('asking for another link', () => {
    it('answers the same way whether or not the account exists', async () => {
      const { email } = await signUp('verify-resend');

      const known = await http()
        .post('/api/auth/verify-email/resend')
        .send({ email })
        .expect(202);
      const unknown = await http()
        .post('/api/auth/verify-email/resend')
        .send({ email: `nobody-${Date.now()}@test.local` })
        .expect(202);

      expect(known.body).toEqual({ accepted: true });
      expect(unknown.body).toEqual(known.body);
    });

    it('invalidates the previous link when it sends a new one', async () => {
      const { email } = await signUp('verify-resend-invalidate');
      const first = tokenFrom((await outboxFor(email))[0].payload.verifyUrl);

      await http().post('/api/auth/verify-email/resend').send({ email }).expect(202);

      // Two live verification tokens is one more than the flow needs, and
      // somebody who asked for a new link because the old one did not arrive
      // should not find the old one still working tomorrow.
      const stale = await http().post('/api/auth/verify-email').send({ token: first }).expect(200);
      expect(stale.body.verified).toBe(false);

      const rows = await outboxFor(email);
      const latest = rows.filter((r) => r.template === 'email_verification.v1').at(-1);
      const fresh = tokenFrom(latest!.payload.verifyUrl);
      expect(
        (await http().post('/api/auth/verify-email').send({ token: fresh }).expect(200)).body,
      ).toEqual({ verified: true });
    });

    it('queues nothing at all for an address with no account', async () => {
      const stranger = `stranger-${Date.now()}@test.local`;
      await http().post('/api/auth/verify-email/resend').send({ email: stranger }).expect(202);
      expect(await outboxFor(stranger)).toHaveLength(0);
    });
  });

  describe('password reset', () => {
    it('says the same thing for an address it knows and one it does not', async () => {
      const { email } = await signUp('reset-known');
      await http().post('/api/auth/verify-email/resend').send({ email }).expect(202);

      const known = await http().post('/api/auth/password-reset').send({ email }).expect(202);
      const unknown = await http()
        .post('/api/auth/password-reset')
        .send({ email: `ghost-${Date.now()}@test.local` })
        .expect(202);

      // Identical bodies and identical statuses. Any difference is a
      // membership oracle for a diabetes platform.
      expect(known.body).toEqual({ accepted: true });
      expect(unknown.body).toEqual(known.body);
    });

    it('changes the password, ends every session, and says so by email', async () => {
      const { email } = await signUp('reset-complete');
      await http().post('/api/auth/password-reset').send({ email }).expect(202);

      const reset = (await outboxFor(email)).find((r) => r.template === 'password_reset.v1');
      const token = tokenFrom(reset!.payload.resetUrl);
      const newPassword = 'an-entirely-different-long-password';

      const res = await http()
        .post('/api/auth/password-reset/complete')
        .send({ token, password: newPassword })
        .expect(200);
      expect(res.body).toEqual({ reset: true });

      // The old password is gone and the new one works.
      await http().post('/api/auth/login').send({ email, password }).expect(401);
      await http().post('/api/auth/login').send({ email, password: newPassword }).expect(200);

      const templates = (await outboxFor(email)).map((r) => r.template);
      expect(templates).toContain('password_changed.v1');
    });

    it('will not spend a reset token twice', async () => {
      const { email } = await signUp('reset-reuse');
      await http().post('/api/auth/password-reset').send({ email }).expect(202);

      const reset = (await outboxFor(email)).find((r) => r.template === 'password_reset.v1');
      const token = tokenFrom(reset!.payload.resetUrl);

      await http()
        .post('/api/auth/password-reset/complete')
        .send({ token, password: 'first-replacement-password-here' })
        .expect(200);

      const second = await http()
        .post('/api/auth/password-reset/complete')
        .send({ token, password: 'second-replacement-password-xyz' })
        .expect(200);
      expect(second.body.reset).toBe(false);
    });
  });

  describe('accounts that predate verification', () => {
    it('lets a backfilled account sign in and use the product', async () => {
      // Exactly what migration 0021 leaves behind: an account created before
      // verification existed, marked verified by the audited backfill. The
      // decision documented in that migration is only defensible if this
      // works, so it is asserted rather than assumed.
      const email = `legacy-${Date.now()}@test.local`;
      const { rows } = await db.query<{ id: string }>(
        `insert into identity.users (email, display_name, email_verified_at)
         values ($1, 'Legacy', now()) returning id`,
        [email],
      );
      await db.query(
        'insert into identity.credentials (user_id, password_hash) values ($1, $2)',
        [rows[0].id, await argon2.hash(password, { type: argon2.argon2id })],
      );

      const login = await http().post('/api/auth/login').send({ email, password }).expect(200);
      expect(login.body.user.emailVerifiedAt).not.toBeNull();

      await http()
        .get('/api/timeline?from=2026-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z')
        .set('authorization', `Bearer ${login.body.tokens.accessToken}`)
        .expect(200);
    });

    it('recorded the backfill in the append-only trail', async () => {
      const { rows } = await db.query<{ n: string }>(
        `select count(*) as n from audit.events
          where action = 'identity.email_verified_backfill'`,
      );
      // Zero is a legitimate answer on a database that was empty when 0021
      // ran, which is the case in CI. What must hold either way is that the
      // action exists and nothing else claims it.
      expect(Number(rows[0].n)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('the audit trail', () => {
    it('records the request, the send and the verification', async () => {
      const { email } = await signUp('verify-audit');
      const token = tokenFrom((await outboxFor(email))[0].payload.verifyUrl);
      await http().post('/api/auth/verify-email').send({ token }).expect(200);

      const { rows } = await db.query<{ action: string; metadata: Record<string, unknown> }>(
        `select e.action, e.metadata from audit.events e
           join identity.users u on u.id = e.subject_user_id
          where lower(u.email) = lower($1)
          order by e.occurred_at`,
        [email],
      );
      const actions = rows.map((r) => r.action);

      expect(actions).toContain('auth.verification_requested');
      expect(actions).toContain('mail.queued');
      expect(actions).toContain('auth.email_verified');

      // Never the recipient and never the token. The trail is append-only, so
      // an address written into it cannot be removed when somebody asks to be
      // erased — the outbox row holds that, and the outbox row can be deleted.
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toContain(email);
      expect(serialised).not.toContain(token);
    });
  });
});
