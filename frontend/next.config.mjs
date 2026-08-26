import { join } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle for the container image. Tracing is
  // rooted at the repo so the @diabetes/types workspace is included.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..'),
  // The shared contract package ships TypeScript-compiled CJS from the
  // workspace; Next needs to transpile it like first-party code.
  transpilePackages: ['@diabetes/types'],
  // `/api/*` is proxied to the backend by a route handler
  // (src/app/api/[...path]/route.ts) rather than a rewrite, because rewrites
  // are resolved at build time and the backend address is a run-time concern.
};

export default nextConfig;
