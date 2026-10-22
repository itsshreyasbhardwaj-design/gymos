import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.GYMOS_DB_PATH ?? './data/gymos.db' },
  strict: true,
} satisfies Config;
