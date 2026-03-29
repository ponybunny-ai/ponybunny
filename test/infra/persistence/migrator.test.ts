import Database from 'better-sqlite3';
import { DatabaseMigrator, type Migration } from '../../../src/infra/persistence/migrator.js';

describe('DatabaseMigrator', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  const baseMigrations: Migration[] = [
    {
      version: 1,
      name: 'create_users',
      up: `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        );
      `,
    },
    {
      version: 2,
      name: 'add_email_to_users',
      up: `ALTER TABLE users ADD COLUMN email TEXT;`,
    },
  ];

  it('applies all migrations to a fresh database', () => {
    const migrator = new DatabaseMigrator(db);
    migrator.run(baseMigrations);

    // Both migrations should be recorded
    const applied = migrator.getAppliedVersions();
    expect(applied.size).toBe(2);
    expect(applied.has(1)).toBe(true);
    expect(applied.has(2)).toBe(true);

    // Table should have the email column
    const info = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    const columnNames = info.map((c) => c.name);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('email');
  });

  it('skips already-applied migrations', () => {
    const migrator = new DatabaseMigrator(db);
    migrator.run(baseMigrations);

    // Run again — should be a no-op
    migrator.run(baseMigrations);

    const applied = migrator.getAppliedVersions();
    expect(applied.size).toBe(2);
  });

  it('applies only new migrations when some are already applied', () => {
    const migrator = new DatabaseMigrator(db);
    migrator.run([baseMigrations[0]]);

    const appliedAfterFirst = migrator.getAppliedVersions();
    expect(appliedAfterFirst.size).toBe(1);

    migrator.run(baseMigrations);

    const appliedAfterBoth = migrator.getAppliedVersions();
    expect(appliedAfterBoth.size).toBe(2);
    expect(appliedAfterBoth.has(2)).toBe(true);
  });

  it('seeds v1 for pre-existing databases with tables but no migrations table', () => {
    // Simulate a database created by the old schema.sql approach
    db.exec(`
      CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    `);

    const migrations: Migration[] = [
      {
        version: 1,
        name: 'initial_schema',
        up: `
          CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, title TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        `,
      },
      {
        version: 2,
        name: 'add_email',
        up: `ALTER TABLE users ADD COLUMN email TEXT;`,
      },
    ];

    const migrator = new DatabaseMigrator(db);
    migrator.run(migrations);

    const applied = migrator.getAppliedVersions();
    // v1 should be seeded as "already applied", v2 should be newly applied
    expect(applied.has(1)).toBe(true);
    expect(applied.has(2)).toBe(true);

    // email column should exist (v2 was applied)
    const info = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    expect(info.map((c) => c.name)).toContain('email');
  });

  it('records applied_at timestamp', () => {
    const before = Date.now();
    const migrator = new DatabaseMigrator(db);
    migrator.run([baseMigrations[0]]);
    const after = Date.now();

    const row = db.prepare('SELECT * FROM schema_migrations WHERE version = 1').get() as {
      version: number;
      name: string;
      applied_at: number;
    };

    expect(row.name).toBe('create_users');
    expect(row.applied_at).toBeGreaterThanOrEqual(before);
    expect(row.applied_at).toBeLessThanOrEqual(after);
  });

  it('rolls back a failed migration without applying partial changes', () => {
    const migrations: Migration[] = [
      {
        version: 1,
        name: 'good_migration',
        up: `CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY);`,
      },
      {
        version: 2,
        name: 'bad_migration',
        up: `CREATE TABLE items_v2 (id TEXT PRIMARY KEY); INVALID SQL HERE;`,
      },
    ];

    const migrator = new DatabaseMigrator(db);
    expect(() => migrator.run(migrations)).toThrow();

    // v1 should be applied, v2 should not
    const applied = migrator.getAppliedVersions();
    expect(applied.has(1)).toBe(true);
    expect(applied.has(2)).toBe(false);

    // items_v2 table should not exist (rolled back)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items_v2'")
      .all();
    expect(tables).toHaveLength(0);
  });

  it('creates schema_migrations table idempotently', () => {
    const migrator = new DatabaseMigrator(db);

    // Run with empty migrations twice — should not error
    migrator.run([]);
    migrator.run([]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
      .all();
    expect(tables).toHaveLength(1);
  });
});
