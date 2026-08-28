import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeBlockers, launchBlockers } from '../src/config/launch';
import type { Env } from '../src/config/env';

/**
 * The rule: this platform must not be able to look live with a known blocker
 * outstanding.
 *
 * Not "should not". Every item in `launchBlockers()` is something that, left
 * unfixed, either exposes a record or tells somebody an untruth about who
 * holds it — and every one is the kind of thing deferred past a launch and
 * then forgotten, because after launch nothing complains about it.
 *
 * `PUBLIC_LAUNCH` is the one switch that makes them all fatal, at the earliest
 * moment each can be caught: the frontend image will not build while a legal
 * placeholder is in a page, and the backend will not start while any of these
 * is open.
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** An environment with every launch requirement met. */
function ready(over: Partial<Env> = {}): Env {
  return {
    TRUST_PROXY: true,
    DATABASE_SSL_REJECT_UNAUTHORIZED: true,
    ...over,
  } as Env;
}

describe('launch blockers', () => {
  it('finds nothing when everything is in place', () => {
    expect(
      launchBlockers({
        env: ready(),
        databaseUrl: 'postgres://u@medical-db:5432/db',
        rateLimitsShared: true,
      }),
    ).toEqual([]);
  });

  it('refuses a database reached by address', () => {
    // verify-full checks the certificate was issued for the host being
    // connected to, and SNI cannot carry an IP literal. There is no
    // certificate that makes this safe, so it is its own blocker rather than
    // a symptom of the TLS one.
    const ids = launchBlockers({
      env: ready(),
      databaseUrl: 'postgres://u@10.10.5.185:5432/db',
      rateLimitsShared: true,
    }).map((b) => b.id);

    expect(ids).toContain('database-host-is-an-address');
  });

  it('refuses an unverified database connection', () => {
    const ids = launchBlockers({
      env: ready({ DATABASE_SSL_REJECT_UNAUTHORIZED: false }),
      databaseUrl: 'postgres://u@medical-db:5432/db',
      rateLimitsShared: true,
    }).map((b) => b.id);

    expect(ids).toContain('database-tls-unverified');
  });

  it('refuses rate limits that are not actually shared', () => {
    // Configured is not the same as working: Redis set and not answering
    // counts per process, which is the state this catches.
    const ids = launchBlockers({
      env: ready(),
      databaseUrl: 'postgres://u@medical-db:5432/db',
      rateLimitsShared: false,
    }).map((b) => b.id);

    expect(ids).toContain('rate-limits-not-shared');
  });

  it('refuses a deployment that cannot tell callers apart', () => {
    const blocker = launchBlockers({
      env: ready({ TRUST_PROXY: false }),
      databaseUrl: 'postgres://u@medical-db:5432/db',
      rateLimitsShared: true,
    }).find((b) => b.id === 'client-addresses-not-known');

    expect(blocker).toBeDefined();
    // The chain has three links and the frontend is the one people forget.
    expect(blocker!.resolution).toContain('frontend');
  });

  it('says what to do, not only what is wrong', () => {
    const all = launchBlockers({
      env: ready({ TRUST_PROXY: false, DATABASE_SSL_REJECT_UNAUTHORIZED: false }),
      databaseUrl: 'postgres://u@10.0.0.1:5432/db',
      rateLimitsShared: false,
    });

    expect(all).toHaveLength(4);
    for (const blocker of all) {
      expect(blocker.problem.length).toBeGreaterThan(30);
      expect(blocker.resolution.length).toBeGreaterThan(20);
    }
    expect(describeBlockers(all)).toContain('fix:');
  });
});

describe('the switch is wired everywhere it can be', () => {
  it('makes the backend refuse to start', () => {
    const main = read('backend/src/main.ts');
    expect(main).toContain('enforceLaunchPosture');
    expect(main).toMatch(/PUBLIC_LAUNCH[\s\S]{0,400}Refusing to start/);
  });

  it('makes the frontend image refuse to build with a placeholder in a page', () => {
    // The last moment it can be caught: by boot the page is compiled.
    const dockerfile = read('frontend/Dockerfile');
    expect(dockerfile).toContain('ARG PUBLIC_LAUNCH');
    expect(dockerfile).toContain('check-launch-blockers.mjs');
  });

  it('is not derived from NODE_ENV', () => {
    // The containers already run NODE_ENV=production because that is how a
    // Node app is built. Tying the launch gate to it would fail every
    // developer's `docker:up`, and a gate that goes red for the shipped
    // configuration is a gate somebody switches off.
    const env = read('backend/src/config/env.ts');
    // The reasoning sits above the declaration, which is where it is read.
    expect(env).toMatch(/Deliberately not derived from NODE_ENV[\s\S]{0,900}PUBLIC_LAUNCH: z/);
  });

  it('is reported by the running process for a canary to read', () => {
    const health = read('backend/src/health/health.controller.ts');
    expect(health).toContain('publicLaunch');
    expect(health).toContain('launchBlockers');
  });
});

describe('the production deployment turns them all on', () => {
  const overlay = read('infra/docker/docker-compose.production.yml');

  it('serves the public with every switch set', () => {
    for (const setting of [
      "PUBLIC_LAUNCH: 'true'",
      "TRUST_PROXY: 'true'",
      "REQUIRE_VERIFIED_DB_TLS: 'true'",
      "REQUIRE_SHARED_RATE_LIMIT: 'true'",
      "DATABASE_SSL_REJECT_UNAUTHORIZED: 'true'",
    ]) {
      expect(overlay).toContain(setting);
    }
  });

  it('names the production site so canonical URLs are right', () => {
    expect(overlay).toContain('https://wellovue.com');
  });

  it('puts the application behind the proxy rather than beside it', () => {
    // Published ports on the app would be a way around TLS and around the
    // proxy that owns the forwarding headers.
    expect(overlay).toMatch(/ports: !reset \[\]/);
  });
});

describe('the proxy owns the forwarding headers', () => {
  const caddyfile = read('infra/proxy/Caddyfile');

  it('overwrites the caller address rather than appending to it', () => {
    // Appending lets a caller prepend a value and choose which rate-limit
    // bucket they land in, which is a rate limit the people it exists to stop
    // can walk around.
    expect(caddyfile).toContain('header_up X-Forwarded-For {remote_host}');
  });

  it('terminates TLS and tells browsers to insist on it', () => {
    expect(caddyfile).toContain('Strict-Transport-Security');
  });

  it('answers nothing on a hostname it was not configured for', () => {
    expect(caddyfile).toMatch(/:80 \{[\s\S]*404/);
  });
});

describe('the forwarding chain is not broken in the middle', () => {
  const proxyRoute = read('frontend/src/app/api/[...path]/route.ts');

  it('passes the header through only when something trustworthy set it', () => {
    // Caddy sets it, the frontend forwards it, the backend reads it. Break any
    // link and the backend keys every request in the deployment on one
    // address, and the rate limiter protects nothing.
    expect(proxyRoute).toContain('TRUST_PROXY');
    expect(proxyRoute).toMatch(/if \(!trustProxy\(\)\) \{[\s\S]{0,200}headers\.delete/);
  });

  it('still drops it by default', () => {
    expect(proxyRoute).toContain("process.env.TRUST_PROXY === 'true'");
  });
});

describe('logs cannot carry a record', () => {
  const backendSources = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...backendSources(path));
      else if (entry.name.endsWith('.ts')) out.push(path);
    }
    return out;
  };

  it('never builds a query by interpolating a value into its text', () => {
    // Two problems at once. An interpolated value is an injection, and the
    // slow-query log prints the first 120 characters of the statement — so an
    // interpolated glucose reading would be written to the log of a health
    // platform. Every query is parameterised, which is what makes that log
    // safe, and this is what keeps it that way.
    const offenders: string[] = [];
    for (const file of backendSources('backend/src')) {
      const text = read(file);
      if (/\b(query|queryOne)<?[^(]*\(\s*`[^`]*\$\{/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('logs the statement without its parameters', () => {
    const db = read('backend/src/database/database.service.ts');
    expect(db).toContain('Slow query');
    // The line logs `text`, never `params`.
    expect(db).not.toMatch(/Slow query[^\n]*params/);
  });

  it('does not log a request body anywhere', () => {
    const offenders: string[] = [];
    for (const file of backendSources('backend/src')) {
      const text = read(file);
      if (/logger\.(log|warn|error|debug)\([^)]*\b(req|request)\.body\b/.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
