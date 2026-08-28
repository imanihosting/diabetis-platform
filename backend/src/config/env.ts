import { z } from 'zod';

/**
 * Environment contract. Validated once at boot so a misconfigured deployment
 * fails immediately and loudly rather than at the first request that needs it.
 */
/** A duration like `15m`, `24h`, or `30d`. */
const ttlSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'must be a duration such as 15m, 24h, or 30d')
  .transform((v) => v as Ttl);

export type Ttl = `${number}${'s' | 'm' | 'h' | 'd'}`;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Where rate limit counts live. Absent means they live in this process.
   *
   * An empty value is read as absent rather than as a malformed URL, because
   * blanking a variable is how somebody turns Redis off — and answering that
   * with "invalid environment configuration" sends them looking for a typo
   * instead of telling them the limits are now per process, which the boot
   * warning says plainly.
   */
  REDIS_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // The bucket may be shared with other systems; everything we write is namespaced.
  S3_PREFIX: z.string().default('diabetes-platform/'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // Validated to the `<number><unit>` shape both `ms` and the Postgres
  // interval conversion in auth.service.ts expect, so a typo fails at boot
  // rather than producing a session with a nonsensical lifetime.
  JWT_ACCESS_TTL: ttlSchema.default('15m'),
  JWT_REFRESH_TTL: ttlSchema.default('30d'),

  METABOLIC_ENGINE_URL: z.string().url().default('http://localhost:8000'),
  METABOLIC_ENGINE_TOKEN: z.string().optional(),

  /**
   * Whether an X-Forwarded-For header may be believed.
   *
   * Off by default, and that default is the safe one: when nothing trustworthy
   * sets the header, anyone can, and a rate limiter that keys on a
   * client-supplied string is worse than none — it is bypassable by the only
   * people it is meant to stop. Turn this on only once every request reaches
   * the backend through a proxy that overwrites the header (nginx, Caddy,
   * Cloudflare, an ALB). See infra/README.md.
   */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Refuse to start when the database connection is encrypted but unverified.
   *
   * Encryption without verification stops passive eavesdropping and does
   * nothing about an active attacker who can answer as the database. The
   * platform currently runs against a self-signed certificate on the VM, so
   * this is opt-in rather than implied by NODE_ENV: turning it on before the
   * CA-signed certificate is in place would stop the service booting. It is
   * the switch to flip on the way to production, and the startup warning says
   * so on every boot until then.
   */
  REQUIRE_VERIFIED_DB_TLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Refuse to start when rate limits are counted per process rather than shared.
   *
   * The same shape as REQUIRE_VERIFIED_DB_TLS, and for the same reason: the
   * unsafe state is the one the platform runs in today, so making it fatal by
   * default would stop a working deployment for a condition it has always had.
   * One backend counting in memory is correct; two are not, because an attacker
   * then gets the limit twice over. Turn this on at the same moment a second
   * replica appears, and the boot warning repeats until somebody does.
   */
  /**
   * Path to a CA certificate the database connection should trust, in addition
   * to the public roots.
   *
   * Deliberately not `NODE_EXTRA_CA_CERTS`, which is the obvious way to do
   * this and the wrong one: that variable widens trust for every TLS
   * connection the process makes — the metabolic engine, object storage,
   * anything added later — so an internal CA meant for one database would end
   * up able to vouch for all of them. This is read once and handed to the
   * database pool alone.
   */
  DATABASE_CA_CERT: z.string().optional(),

  REQUIRE_SHARED_RATE_LIMIT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Warn above this many milliseconds of actual statement execution.
   *
   * Separate from connection acquisition, which is timed and reported on its
   * own. Raise it on a machine that reaches the database over a VPN: every
   * query there carries ~55ms of round trip that will not exist once the
   * backend is deployed beside the database, and warnings nobody can act on
   * are how people learn to stop reading warnings.
   */
  SLOW_QUERY_WARN_MS: z.coerce.number().int().positive().default(250),
  SLOW_ACQUIRE_WARN_MS: z.coerce.number().int().positive().default(1000),

  // Rate limits. Configurable because the right number depends on how the
  // service is fronted, and because the test suite needs to reach them
  // deliberately without waiting fifteen minutes.
  THROTTLE_GLOBAL_LIMIT: z.coerce.number().int().positive().default(300),
  THROTTLE_GLOBAL_TTL_S: z.coerce.number().int().positive().default(60),
  /** Sign-in and registration. Deliberately tight: this is the brute-force surface. */
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_AUTH_TTL_S: z.coerce.number().int().positive().default(900),
  /** Session refresh. Looser: several tabs legitimately refresh at once. */
  THROTTLE_REFRESH_LIMIT: z.coerce.number().int().positive().default(60),
  THROTTLE_REFRESH_TTL_S: z.coerce.number().int().positive().default(900),
  /** Unauthenticated writes that reach a human or a table: waitlist, contact. */
  THROTTLE_WRITE_LIMIT: z.coerce.number().int().positive().default(5),
  THROTTLE_WRITE_TTL_S: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Exported for tests, which need to parse several environments in one process.
 *
 * `loadEnv` caches after the first call — deliberately, so configuration is
 * validated once — which makes it the wrong seam for checking parsing rules.
 */
export { envSchema };

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  cached = parsed.data;
  return cached;
}

export const ENV = Symbol('ENV');
