import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/frontend/src/**/*.{ts,tsx}'],
    ignores: [
      'packages/frontend/src/lib/api-client.ts',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/*.stories.{ts,tsx}',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mock/**', '**/prototype/**', '@/mock/**', '@/prototype/**', '../mock/**', '../prototype/**'],
              message: 'Importing mock or prototype data outside tests/stories is strictly forbidden.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            'Direct fetch() is strictly forbidden in frontend components. Use apiClient from "@/lib/api-client" instead.',
        },
        {
          selector: "Literal[value='eventora_auth_token']",
          message:
            'Direct access to eventora_auth_token is strictly forbidden. Eventora uses authoritative HTTP-only session cookies.',
        },
      ],
    },
  },
];
