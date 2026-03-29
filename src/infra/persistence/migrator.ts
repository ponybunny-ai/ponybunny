/**
 * DatabaseMigrator — versioned, ordered SQLite schema migration system.
 *
 * Replaces the ad-hoc schema.sql + schema-migration-v2.sql pattern with
 * a tracked migration table (`schema_migrations`) that records which
 * migrations have been applied and when.
 *
 * Design decisions:
 *   - Migrations are up-only (no rollback). Rollback in SQLite is fragile
 *     because ALTER TABLE support is limited.
 *   - Each migration runs inside a transaction.
 *   - The full current schema.sql is migration v1, making bootstrapping
 *     safe for both fresh and existing databases (all DDL uses IF NOT EXISTS).
 *   - The migrator detects pre-existing databases (tables exist but no
 *     schema_migrations table) and seeds v1 as "already applied".
 */

import type Database from 'better-sqlite3';

export interface Migration {
  /** Monotonically increasing version number. */
  version: number;
  /** Human-readable name, stored in schema_migrations for auditability. */
  name: string;
  /** SQL to execute. May contain multiple statements. */
  up: string;
}

export class DatabaseMigrator {
  constructor(private readonly db: Database.Database) {}

  /**
   * Apply all pending migrations in order.
   *
   * Safe to call on:
   *   - A brand-new empty database (applies all migrations from v1).
   *   - An existing database bootstrapped via the old schema.sql approach
   *     (detects existing tables, seeds schema_migrations, applies only new ones).
   *   - A database already managed by this migrator (skips applied migrations).
   */
  run(migrations: Migration[]): void {
    this.ensureMigrationsTable();
    this.seedExistingDatabase(migrations);

    const applied = this.getAppliedVersions();

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;

      this.db.transaction(() => {
        this.db.exec(migration.up);
        this.db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, Date.now());
      })();
    }
  }

  /** Return the set of applied migration versions. */
  getAppliedVersions(): Set<number> {
    const rows = this.db
      .prepare('SELECT version FROM schema_migrations')
      .all() as Array<{ version: number }>;
    return new Set(rows.map((r) => r.version));
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
  }

  /**
   * For databases created before the migration system existed:
   * if the database already has tables but no schema_migrations records,
   * mark migration v1 (the base schema) as applied so we don't re-run it.
   */
  private seedExistingDatabase(migrations: Migration[]): void {
    const hasRecords = (this.db
      .prepare('SELECT COUNT(*) AS cnt FROM schema_migrations')
      .get() as { cnt: number }).cnt > 0;

    if (hasRecords) return;

    // Check if this is a pre-existing database by looking for core tables.
    const hasGoalsTable = this.tableExists('goals');
    if (!hasGoalsTable) return; // Fresh database — nothing to seed.

    // The database was bootstrapped via the old schema.sql approach.
    // Mark the base schema migration as already applied.
    const baseMigration = migrations.find((m) => m.version === 1);
    if (baseMigration) {
      this.db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
      ).run(baseMigration.version, baseMigration.name, Date.now());
    }
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name=?")
      .get(name) as { cnt: number };
    return row.cnt > 0;
  }
}
