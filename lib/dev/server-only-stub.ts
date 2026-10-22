/**
 * No-op stand-in for the `server-only` marker module.
 *
 * `server-only` deliberately throws when it is resolved outside a React Server
 * Component graph. Scripts and tests load the same server modules directly, so they
 * resolve this file instead (see tsconfig.scripts.json and vitest.config.ts).
 * Application code is unaffected: Next.js still enforces the real marker at build time.
 */
export {};
