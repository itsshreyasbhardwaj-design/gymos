/** Seeds the shared content library into the configured SQLite database. */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../lib/db/schema';
import { resolveDbPath } from '../lib/db/path';
import { seedContent } from '../lib/db/seed-content';
import { validateExerciseCatalog } from '../lib/content/exercises';
import { validateRecipeCatalog } from '../lib/content/recipes';

const issues = [...validateExerciseCatalog(), ...validateRecipeCatalog()];
if (issues.length > 0) {
  console.error('Refusing to seed: content validation failed.');
  for (const i of issues) console.error(` [${i.kind}] ${i.id}: ${i.detail}`);
  process.exit(1);
}

const sqlite = new Database(resolveDbPath());
sqlite.pragma('foreign_keys = ON');
seedContent(drizzle(sqlite, { schema }));

const tables = [
  'equipment_types',
  'exercises',
  'exercise_equipment',
  'exercise_variations',
  'allergens',
  'ingredients',
  'recipes',
  'recipe_ingredients',
  'entitlements',
];
console.log('seeded:');
for (const table of tables) {
  const row = sqlite.prepare(`select count(*) c from ${table}`).get() as { c: number };
  console.log(`  ${table}: ${row.c}`);
}
sqlite.close();
