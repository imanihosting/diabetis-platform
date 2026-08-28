import { describe, expect, it } from 'vitest';
import { connectsToBareAddress } from '../src/config/database-url';
import { envSchema } from '../src/config/env';

/**
 * The two boot-time refusals, and the trap one of them exists to answer.
 *
 * `REQUIRE_VERIFIED_DB_TLS=true` against a bare IP address cannot succeed and
 * cannot be made to succeed by installing a certificate: `verify-full` checks
 * that the certificate was issued for the host being connected to, and RFC
 * 6066 does not permit an IP literal in SNI, so there is no name to check
 * against. Someone who flips the flag without reading infra/README.md gets a
 * TLS handshake failure and goes looking for a problem with their certificate,
 * which is a week of the wrong work. The boot check answers with the actual
 * blocker: the host needs a DNS name first.
 */
describe('database URL host detection', () => {
  it('recognises the IP literal the platform runs against today', () => {
    expect(
      connectsToBareAddress('postgresql://app:pw@10.10.5.185:5432/diabetes?sslmode=require'),
    ).toBe(true);
  });

  it('recognises other bare addresses, including IPv6 and loopback', () => {
    for (const url of [
      'postgresql://app:pw@127.0.0.1:5432/db',
      'postgresql://app:pw@192.168.3.10/db',
      'postgresql://app:pw@[2001:db8::1]:5432/db',
    ]) {
      expect(connectsToBareAddress(url)).toBe(true);
    }
  });

  it('accepts a name, which is the thing that unblocks verification', () => {
    for (const url of [
      'postgresql://app:pw@db.wellovue.internal:5432/diabetes?sslmode=verify-full',
      'postgresql://app:pw@localhost:5432/db',
      'postgresql://app:pw@postgres/db',
    ]) {
      expect(connectsToBareAddress(url)).toBe(false);
    }
  });

  it('treats an unset or unparseable URL as not-a-bare-address', () => {
    // The check exists to produce a better error, never to become one. A
    // malformed URL is somebody else's failure to report, and reporting it
    // here as "you used an IP address" would be a lie.
    expect(connectsToBareAddress(undefined)).toBe(false);
    expect(connectsToBareAddress('not a url at all')).toBe(false);
  });
});

/**
 * The two switches that turn a tolerated state into a refusal to start.
 *
 * Both default to off, and that default is load-bearing: the unsafe states are
 * the ones the platform has always run in, so making them fatal by default
 * would stop a working deployment for a condition it already had. They are
 * flipped at a specific knowable moment — a certificate for TLS, a second
 * replica for the rate limiter.
 */
describe('launch switches', () => {
  const base: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgresql://u:p@medical-db:5432/db',
    JWT_SECRET: 'a-secret-long-enough-to-satisfy-validation',
    S3_ENDPOINT: 'http://10.10.5.240:9000',
    S3_REGION: 'limk-dub',
    S3_BUCKET: 'medicaldata',
    S3_ACCESS_KEY_ID: 'x',
    S3_SECRET_ACCESS_KEY: 'y',
  };

  // The schema rather than `loadEnv`, which caches after its first call so
  // that configuration is validated once. That makes it the wrong seam for
  // checking parsing rules across several environments in one process.
  const parse = (extra: NodeJS.ProcessEnv = {}) => envSchema.parse({ ...base, ...extra });

  it('defaults both refusals to off', () => {
    const env = parse();
    expect(env.REQUIRE_VERIFIED_DB_TLS).toBe(false);
    expect(env.REQUIRE_SHARED_RATE_LIMIT).toBe(false);
  });

  it('reads an empty REDIS_URL as absent, not as malformed', () => {
    // Blanking the variable is how somebody turns Redis off. Answering that
    // with "invalid environment configuration" sends them hunting for a typo
    // instead of showing them the boot warning that explains what they just
    // changed.
    expect(parse({ REDIS_URL: '' }).REDIS_URL).toBeUndefined();
    expect(parse().REDIS_URL).toBeUndefined();
    expect(parse({ REDIS_URL: 'redis://redis:6379' }).REDIS_URL).toBe(
      'redis://redis:6379',
    );
  });

  it('still rejects a REDIS_URL that is set to nonsense', () => {
    // Tolerating empty must not become tolerating wrong: a typo in a real
    // value should fail loudly rather than silently fall back to per-process
    // counts that nobody asked for.
    expect(() => parse({ REDIS_URL: 'not-a-url' })).toThrow();
  });
});
