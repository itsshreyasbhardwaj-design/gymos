import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * In-memory database for tests, built from the committed migration SQL so tests
 * exercise exactly the schema that ships.
 */
export function createTestDb(): { db: TestDb; close: () => void } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, close: () => sqlite.close() };
}

export function applyMigrations(sqlite: Database.Database): void {
  const dir = path.join(process.cwd(), 'drizzle');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error('No migration SQL found in ./drizzle — run `npm run db:generate` first.');
  }
  for (const file of files) {
    const sqlText = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}
