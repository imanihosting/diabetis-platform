import { FlatCompat } from '@eslint/eslintrc';

// `next lint` is deprecated in Next 15 and removed in 16, so the project uses
// the ESLint CLI directly. FlatCompat bridges eslint-config-next, which is
// still published as an eslintrc-style config.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
];

export default config;
