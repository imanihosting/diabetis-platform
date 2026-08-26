import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
  plugins: [
    // Vitest transforms with esbuild, which cannot emit decorator metadata.
    // Without it NestJS dependency injection resolves every constructor
    // parameter as undefined. SWC emits the metadata NestJS needs.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
