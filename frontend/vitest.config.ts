import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Test setup for the SEO suite.
 *
 * `next/navigation` is stubbed so a public page can be rendered to static
 * markup outside a Next request. That is the point of the whole config: the
 * alternative is asserting things about page source text, and a test that
 * greps for `<h1` proves nothing about a page whose heading arrives through a
 * component two levels down — which is how every page on this site is built.
 * Rendering the tree means the assertions are about what a crawler receives.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: /^next\/navigation$/, replacement: resolve(__dirname, 'test/stubs/next-navigation.ts') },
      { find: /^@\//, replacement: `${resolve(__dirname, 'src')}/` },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
  },
});
