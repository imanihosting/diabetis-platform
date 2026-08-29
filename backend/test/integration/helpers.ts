import type request from 'supertest';
import { Client } from 'pg';

/**
 * Connects to the database the test stack provisions.
 *
 * Integration tests run against a real PostgreSQL with TimescaleDB and
 * pgvector, because the guarantees under test — hypertables, guard triggers,
 * check constraints — do not exist anywhere else. A mock would test nothing.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Integration tests need the Docker test stack:\n' +
        '  npm run test:docker',
    );
  }
  return url;
}

export function testClientConfig() {
  const url = new URL(requireDatabaseUrl());
  const sslmode = url.searchParams.get('sslmode') ?? 'prefer';
  url.searchParams.delete('sslmode');
  return {
    connectionString: url.toString(),
    ssl:
      sslmode === 'disable'
        ? false
        : { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' },
  };
}

export async function connect(): Promise<Client> {
  const client = new Client(testClientConfig());
  await client.connect();
  return client;
}

/** Creates a throwaway user and returns its id. */
export async function createUser(client: Client, label: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into identity.users (email, display_name)
     values ($1, $2) returning id`,
    [`${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, label],
  );
  return rows[0].id;
}

/** Runs `fn` and returns the error it threw, or null if it succeeded. */
export async function captureError(fn: () => Promise<unknown>): Promise<Error | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return err as Error;
  }
}

/**
 * Takes a freshly registered account through email verification.
 *
 * Registration leaves an account unverified, and an unverified account is
 * refused every product route — so any suite that registers an account and
 * then uses it has to do this, exactly as a person would.
 *
 * It goes through the real endpoint rather than setting the column, and reads
 * the token out of the queued outbox row's `payload`, which is the only place
 * the secret half of the token exists: the token table stores a hash. That
 * makes this the same path a browser takes, and it means a change that breaks
 * verification breaks every suite rather than quietly passing them all.
 *
 * Requires MAIL_ENABLED with MAIL_DRY_RUN, which is what backend/.env.test and
 * the test compose file both set. With mail disabled the row is written
 * `skipped` and carries no payload, and this throws saying so.
 */
export async function verifyEmailFor(
  agent: () => request.Agent,
  db: Client,
  email: string,
): Promise<void> {
  const { rows } = await db.query<{ url: string | null }>(
    `select payload->>'verifyUrl' as url
       from notify.mail_outbox
      where lower(recipient_email) = lower($1)
        and template like 'email_verification%'
      order by created_at desc
      limit 1`,
    [email],
  );

  const url = rows[0]?.url;
  if (!url) {
    throw new Error(
      `No verification email was queued for ${email}. This suite needs ` +
        'MAIL_ENABLED=true and MAIL_DRY_RUN=true — see backend/.env.test.',
    );
  }

  const token = new URL(url).searchParams.get('token');
  await agent().post('/api/auth/verify-email').send({ token }).expect(200);
}
