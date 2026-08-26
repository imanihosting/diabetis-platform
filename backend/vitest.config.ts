import { defineConfig } from 'vitest/config';
import { swcTransform } from './vitest-swc-plugin';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/*.spec.ts', 'src/**/*.spec.ts'],
  },
  plugins: [swcTransform()],
});
