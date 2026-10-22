/** Applies committed migration SQL to the configured SQLite database. */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { resolveDbPath } from '../lib/db/path';

const dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = OFF');

sqlite.exec(
  `CREATE TABLE IF NOT EXISTS __migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
);
const applied = new Set(
  sqlite.prepare<[], { id: string }>('SELECT id FROM __migrations').all().map((r) => r.id),
);

const dir = path.join(process.cwd(), 'drizzle');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const tx = sqlite.transaction(() => {
    for (const stmt of text.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
    sqlite
      .prepare('INSERT INTO __migrations (id, applied_at) VALUES (?, ?)')
      .run(file, new Date().toISOString());
  });
  tx();
  console.log(`applied ${file}`);
  count += 1;
}
sqlite.pragma('foreign_keys = ON');
console.log(count === 0 ? 'migrations: up to date' : `migrations: applied ${count}`);
sqlite.close();
