/**
 * Ordered migration array for the main PonyBunny database.
 *
 * Rules:
 *   - Versions are monotonically increasing integers (no gaps).
 *   - Each migration's `up` SQL must be safe to run inside a transaction.
 *   - All DDL should use IF NOT EXISTS so re-running on a pre-existing
 *     database (seeded via the old schema.sql) is harmless.
 *   - Never modify a released migration — add a new one instead.
 */

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import type { Migration } from '../migrator.js';
import { getPersistenceAssetCandidates } from '../../config/runtime-asset-paths.js';

function readPersistenceAsset(fileName: string): string {
  const candidates = getPersistenceAssetCandidates(fileName);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf-8');
    }
  }
  throw new Error(`Could not locate persistence asset: ${fileName}`);
}

/**
 * Main database migrations. Applied in version order by DatabaseMigrator.
 *
 * Migration v1 is the full current schema.sql — it bootstraps a fresh
 * database with all tables. For existing databases, the migrator detects
 * that tables already exist and marks v1 as "already applied".
 */
export const MAIN_DB_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    get up() {
      return readPersistenceAsset('schema.sql');
    },
  },
];

/**
 * Memory database migrations (sessions, embeddings, core memories).
 * Applied to a separate SQLite file.
 */
export const MEMORY_DB_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_memory_schema',
    get up() {
      return readPersistenceAsset('schema-memory.sql');
    },
  },
];
