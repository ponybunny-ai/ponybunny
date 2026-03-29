/**
 * Shared schema initialization for CLI commands.
 *
 * Provides a simple function that CLI commands can call to ensure
 * the database has the correct schema. Uses DatabaseMigrator internally
 * but exposes a simpler API for CLI use cases.
 */

import type Database from 'better-sqlite3';
import { DatabaseMigrator } from './migrator.js';
import { MAIN_DB_MIGRATIONS, MEMORY_DB_MIGRATIONS } from './migrations/index.js';

/**
 * Ensure the main database (goals, work_items, runs, etc.) has the correct schema.
 */
export function ensureMainSchema(db: Database.Database): void {
  new DatabaseMigrator(db).run(MAIN_DB_MIGRATIONS);
}

/**
 * Ensure the memory database (sessions, embeddings, core_memories) has the correct schema.
 */
export function ensureMemorySchema(db: Database.Database): void {
  new DatabaseMigrator(db).run(MEMORY_DB_MIGRATIONS);
}
