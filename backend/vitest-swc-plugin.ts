import { transform } from '@swc/core';
import type { Plugin } from 'vite';

/**
 * Transforms TypeScript with SWC so NestJS dependency injection works in tests.
 *
 * Vitest transforms with esbuild, which cannot emit `design:paramtypes`
 * metadata. Without it every injected constructor parameter resolves to
 * `undefined` and the application fails to build at all — silently, as a
 * confusing "cannot read properties of undefined" deep inside Nest.
 *
 * Written inline rather than pulled from a plugin package: this is twenty
 * lines, it needs no configuration beyond what the app already implies, and
 * the alternative added a dependency whose own tree would not install
 * reliably.
 */
export function swcTransform(): Plugin {
  return {
    name: 'wellovue-swc-transform',
    // Must run before esbuild claims the file.
    enforce: 'pre',
    async transform(code: string, id: string) {
      if (!/\.tsx?$/.test(id) || id.includes('node_modules')) return null;

      const result = await transform(code, {
        filename: id,
        sourceMaps: true,
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: {
            legacyDecorator: true,
            decoratorMetadata: true,
          },
        },
        module: { type: 'es6' },
      });

      return { code: result.code, map: result.map };
    },
  };
}
