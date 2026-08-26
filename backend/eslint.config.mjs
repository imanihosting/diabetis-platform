import tseslint from 'typescript-eslint';

const config = tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // NestJS decorators depend on parameter metadata that the base rule
      // reads as unused; allow the leading-underscore convention instead.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);

export default config;
