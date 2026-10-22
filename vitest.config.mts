import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globals: true,
    pool: 'forks',
    coverage: { provider: 'v8', include: ['lib/**/*.ts'], reporter: ['text', 'json-summary'] },
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
      // `server-only` throws by design outside a React Server Component graph.
      // Tests exercise the same server modules directly, so point it at the no-op build.
      'server-only': new URL('node_modules/server-only/empty.js', import.meta.url).pathname,
    },
  },
});
