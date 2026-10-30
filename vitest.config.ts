import { defineConfig } from 'vitest/config';
import path from 'path';

const resolvedDatabaseUrl =
  process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== ''
    ? process.env.DATABASE_URL
    : 'postgresql://postgres@127.0.0.1:5433/eventora_db';

try {
  const parsed = new URL(resolvedDatabaseUrl);
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error('Refusing to run destructive integration tests against a non-local database');
  }
} catch (err: unknown) {
  if (err instanceof Error && err.message === 'Refusing to run destructive integration tests against a non-local database') {
    throw err;
  }
  throw new Error('Refusing to run destructive integration tests against a non-local database: invalid DATABASE_URL');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.{test,spec}.ts', 'tests/security/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', 'tests/e2e/**'],
    hookTimeout: 30000,
    testTimeout: 30000,
    fileParallelism: false,
    env: {
      DATABASE_URL: resolvedDatabaseUrl,
      OFFLINE_MANIFEST_SECRET: 'test_manifest_secret_key_32_bytes_super_secure',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/backend/src/services/**/*.ts'],
      exclude: ['**/node_modules/**', '**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
    },
  },
  resolve: {
    alias: {
      '@eventora/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@eventora/backend': path.resolve(__dirname, './packages/backend/src'),
      '@': path.resolve(__dirname, './packages/frontend/src'),
    },
  },
});
