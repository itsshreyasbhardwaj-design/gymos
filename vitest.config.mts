import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globals: true,
    pool: 'forks',
    // Every integration suite registers accounts in `beforeAll`, and registration runs
    // scrypt at N=2^15 by design. With one worker spawned per file those hooks contend,
    // and the default 10s ceiling produced a cold-run "Hook timed out" on a suite that
    // completes in under 3s in isolation. The work is not slow; the ceiling was.
    hookTimeout: 60_000,
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
