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
