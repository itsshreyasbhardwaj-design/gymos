/** Builds a clean database for the end-to-end run, separate from development data. */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../lib/db/schema';
import { seedContent } from '../lib/db/seed-content';

const dbPath = process.env.GYMOS_DB_PATH ?? path.join(process.cwd(), 'data', 'e2e.db');
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${dbPath}${suffix}`, { force: true });
}
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = OFF');
const dir = path.join(process.cwd(), 'drizzle');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const stmt of text.split('--> statement-breakpoint')) {
    if (stmt.trim()) sqlite.exec(stmt.trim());
  }
}
sqlite.pragma('foreign_keys = ON');
seedContent(drizzle(sqlite, { schema }));
sqlite.close();
console.log(`e2e database ready at ${dbPath}`);
