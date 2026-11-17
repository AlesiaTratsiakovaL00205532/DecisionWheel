import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'reports/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', {
        args: 'all',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['src/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['public/**/*.js', 'tests/browser/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
