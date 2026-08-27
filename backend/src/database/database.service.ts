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

  /**
   * Thresholds for the two warnings in `query`.
   *
   * Execution and acquisition are timed separately because they fail for
   * unrelated reasons: a slow statement wants an index, a slow acquisition
   * wants a bigger pool or a connection that stopped being dropped. Measured
   * against the production VM, the login lookup executes in 0.048ms and the
   * client observes ~100ms, so nearly everything seen from a developer machine
   * is VPN round-trip rather than work.
   */
  private readonly slowQueryMs: number;
  private readonly slowAcquireMs: number;

  constructor(@Inject(ENV) env: Env) {
    this.slowQueryMs = env.SLOW_QUERY_WARN_MS;
    this.slowAcquireMs = env.SLOW_ACQUIRE_WARN_MS;

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
      // Establishing a connection to the database costs ~700ms measured from a
      // developer machine: a TCP handshake and a TLS handshake across the VPN.
      // Dropping idle clients after 30 seconds meant a quiet service paid that
      // again on the next request, and the cost landed on whichever query
      // happened to be first. Ten minutes keeps a warm client through normal
      // gaps in traffic.
      idleTimeoutMillis: 600_000,
      // Without keepalive probes the firewall between here and the VM silently
      // drops an idle connection, and the pool only finds out when it hands
      // that dead client to a request. This is the same failure the metabolic
      // engine shows as `discarding closed connection`.
      keepAlive: true,
      keepAliveInitialDelayMillis: 30_000,
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
    // Waiting for a client and running the statement are timed separately,
    // because they fail for unrelated reasons and the fix for one does nothing
    // for the other. Timing them together produced warnings like
    // `Slow query (1571ms): select 1 as ok`, which is not a slow query at all:
    // `select 1` executes in microseconds and the time was a fresh TLS
    // handshake. A warning that names the wrong culprit sends the next person
    // hunting for an index that would have changed nothing.
    const requested = Date.now();
    const client = await this.pool.connect();
    const acquired = Date.now();
    try {
      const result = await client.query<T>(text, params);
      const executed = Date.now();

      const waited = acquired - requested;
      const ran = executed - acquired;

      if (waited > this.slowAcquireMs) {
        this.logger.warn(
          `Slow connection acquire (${waited}ms) — pool exhausted, or a new ` +
            'TCP/TLS handshake. Not the statement.',
        );
      }
      if (ran > this.slowQueryMs) {
        this.logger.warn(`Slow query (${ran}ms): ${text.slice(0, 120)}`);
      }

      return result.rows;
    } finally {
      client.release();
    }
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
