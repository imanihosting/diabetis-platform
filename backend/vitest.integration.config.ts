import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import { swcTransform } from './vitest-swc-plugin';

/**
 * Loads .env.test for local runs, without clobbering variables the environment
 * already provides. Inside the Docker test stack compose injects the real
 * values, and those must win.
 */
function loadTestEnvDefaults(): void {
  const file = join(import.meta.dirname, '.env.test');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] === undefined) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadTestEnvDefaults();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.spec.ts'],
    // Integration tests share one database. Running files in parallel would
    // make them race on the same rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  // NestJS DI needs decorator metadata that esbuild cannot emit — see
  // vitest-swc-plugin.ts.
  plugins: [swcTransform()],
});
