import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

describe('Persistence schema separation', () => {
  it('keeps work-order tables in main schema only', () => {
    const db = new Database(':memory:');
    const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));

    expect(hasTable(db, 'goals')).toBe(true);
    expect(hasTable(db, 'work_items')).toBe(true);
    expect(hasTable(db, 'sessions')).toBe(false);
    expect(hasTable(db, 'memory_entries')).toBe(false);
    expect(hasTable(db, 'core_memories')).toBe(false);

    db.close();
  });

  it('keeps conversation memory tables in memory schema only', () => {
    const db = new Database(':memory:');
    const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema-memory.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));

    expect(hasTable(db, 'sessions')).toBe(true);
    expect(hasTable(db, 'session_turns')).toBe(true);
    expect(hasTable(db, 'memory_entries')).toBe(true);
    expect(hasTable(db, 'core_memories')).toBe(true);
    expect(hasTable(db, 'goals')).toBe(false);
    expect(hasTable(db, 'work_items')).toBe(false);

    db.close();
  });
});
