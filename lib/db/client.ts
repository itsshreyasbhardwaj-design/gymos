import 'server-only';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { resolveDbPath } from './path';

declare global {
  var __gymosDb: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  const sqlite = new Database(resolveDbPath());
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema });
}

/** Single shared connection — survives Next.js dev hot-reloads. */
export const db = globalThis.__gymosDb ?? createDb();
if (process.env.NODE_ENV !== 'production') globalThis.__gymosDb = db;

export type Db = typeof db;
export { schema };
