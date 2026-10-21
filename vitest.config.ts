import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@eventora/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './packages/frontend/src'),
    },
  },
});
