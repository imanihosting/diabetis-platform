import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/*.spec.ts', 'src/**/*.spec.ts'],
  },
  plugins: [
    // Vitest transforms with esbuild, which cannot emit decorator metadata.
    // Without it NestJS dependency injection resolves every constructor
    // parameter as undefined. SWC emits the metadata NestJS needs.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
