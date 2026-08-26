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

  REDIS_URL: z.string().url().optional(),

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
});

export type Env = z.infer<typeof envSchema>;

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
