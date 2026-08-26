import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { ENV, type Env } from '../config/env';

/**
 * Thin typed wrapper over a node-postgres pool.
 *
 * Deliberately not an ORM. The schema leans on TimescaleDB hypertables,
 * pgvector operators, and PL/pgSQL guard triggers — all of which ORMs model
 * badly. Queries live in repositories next to the domain that owns them.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    // node-pg lets `sslmode` in the URL override an explicit `ssl` option and
    // reads `require` more strictly than libpq. Strip it and decide here, so
    // the same DATABASE_URL works for psql, psycopg, and node alike.
    const url = new URL(env.DATABASE_URL);
    const sslmode = url.searchParams.get('sslmode') ?? 'prefer';
    url.searchParams.delete('sslmode');

    this.pool = new Pool({
      connectionString: url.toString(),
      ssl:
        sslmode === 'disable'
          ? false
          : { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED },
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'wellovue-backend',
    });

    this.pool.on('error', (err) => {
      this.logger.error(`Idle client error: ${err.message}`, err.stack);
    });
  }

  async onModuleInit(): Promise<void> {
    const { rows } = await this.pool.query<{ version: string }>('select version()');
    this.logger.log(`Connected: ${rows[0].version.split(',')[0]}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const started = Date.now();
    const result = await this.pool.query<T>(text, params);
    const elapsed = Date.now() - started;
    if (elapsed > 500) {
      this.logger.warn(`Slow query (${elapsed}ms): ${text.slice(0, 120)}`);
    }
    return result.rows;
  }

  /** Returns the single expected row, or null. Throws if more than one row comes back. */
  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    if (rows.length > 1) {
      throw new Error(`Expected at most 1 row, got ${rows.length}`);
    }
    return rows[0] ?? null;
  }

  /**
   * Runs `fn` inside a transaction, rolling back on any throw.
   * Use this whenever a write must be paired with its audit entry.
   */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Used by the health check. */
  async ping(): Promise<boolean> {
    const rows = await this.query<{ ok: number }>('select 1 as ok');
    return rows[0]?.ok === 1;
  }
}
