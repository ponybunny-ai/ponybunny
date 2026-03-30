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
  {
    version: 2,
    name: 'metrics_tables',
    up: `
      CREATE TABLE IF NOT EXISTS metric_counters (
        name       TEXT    NOT NULL,
        labels     TEXT    NOT NULL,
        value      REAL    NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (name, labels)
      );

      CREATE TABLE IF NOT EXISTS metric_samples (
        name        TEXT    NOT NULL,
        labels      TEXT    NOT NULL,
        value       REAL    NOT NULL,
        recorded_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_metric_samples_name
        ON metric_samples (name, recorded_at);
    `,
  },
  {
    version: 3,
    name: 'goal_evaluation_reports',
    up: `
      CREATE TABLE IF NOT EXISTS goal_evaluation_reports (
        id         TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        goal_id    TEXT NOT NULL,
        "trigger"  TEXT NOT NULL CHECK("trigger" IN ('goal_completed', 'goal_failed', 'goal_blocked')),
        work_item_results      TEXT NOT NULL,
        summary_total          INTEGER NOT NULL DEFAULT 0,
        summary_publish        INTEGER NOT NULL DEFAULT 0,
        summary_retry          INTEGER NOT NULL DEFAULT 0,
        summary_replan         INTEGER NOT NULL DEFAULT 0,
        summary_escalate       INTEGER NOT NULL DEFAULT 0,
        summary_skipped        INTEGER NOT NULL DEFAULT 0,
        unactionable_decisions TEXT,
        FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_goal_eval_reports_goal
        ON goal_evaluation_reports(goal_id);

      CREATE INDEX IF NOT EXISTS idx_goal_eval_reports_created
        ON goal_evaluation_reports(created_at DESC);
    `,
  },
  {
    version: 4,
    name: 'global_knowledge_extension',
    get up() {
      return readPersistenceAsset('migrations/v4-global-knowledge-extension.sql');
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
