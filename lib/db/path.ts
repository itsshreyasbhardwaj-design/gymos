import path from 'node:path';

/**
 * Local development stores the database on disk. A stateless/serverless deployment
 * must point GYMOS_DB_PATH at a durable volume or migrate to PostgreSQL first
 * (see DEPLOYMENT.md).
 */
export function resolveDbPath(): string {
  const configured = process.env.GYMOS_DB_PATH;
  if (configured) return configured;
  return path.join(process.cwd(), 'data', 'gymos.db');
}
