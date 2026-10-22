import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Points the application's database singleton at a fresh temporary file.
 *
 * Must be called BEFORE importing anything that touches `lib/db/client`, because the
 * client resolves its path at module load — which is why the integration suites import
 * their services dynamically inside `beforeAll`.
 */
export function createTempDatabase(): { path: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymos-test-'));
  const dbPath = path.join(dir, `${randomUUID()}.db`);
  process.env.GYMOS_DB_PATH = dbPath;
  return {
    path: dbPath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Temp cleanup is best-effort.
      }
    },
  };
}

/** Applies migrations + content seed to the database at GYMOS_DB_PATH. */
export async function prepareDatabase(): Promise<void> {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('@/lib/db/schema');
  const { seedContent } = await import('@/lib/db/seed-content');

  const dbPath = process.env.GYMOS_DB_PATH;
  if (!dbPath) throw new Error('createTempDatabase() must run before prepareDatabase()');

  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = OFF');
  const dir = path.join(process.cwd(), 'drizzle');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error('No migrations found in ./drizzle');
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const stmt of text.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  sqlite.pragma('foreign_keys = ON');
  seedContent(drizzle(sqlite, { schema }));
  sqlite.close();
}
