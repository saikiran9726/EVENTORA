import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.{test,spec}.ts', 'tests/security/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@eventora/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@eventora/backend': path.resolve(__dirname, './packages/backend/src'),
      '@': path.resolve(__dirname, './packages/frontend/src'),
    },
  },
});
