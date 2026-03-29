import Database from 'better-sqlite3';
import { PersistentSchedulerMetrics } from '../../../src/scheduler/core/persistent-metrics.js';
import type { SchedulerCounters } from '../../../src/scheduler/core/persistent-metrics.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

function seedMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES (?, ?, ?)').run(
    key,
    value,
    Date.now()
  );
}

describe('PersistentSchedulerMetrics', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it('starts with zero counters', () => {
    const metrics = new PersistentSchedulerMetrics(db);
    expect(metrics.getCounters()).toEqual({
      goalsProcessed: 0,
      runsExecuted: 0,
      workItemsCompleted: 0,
    });
  });

  it('restore() loads saved counters from meta table', () => {
    const saved: SchedulerCounters = {
      goalsProcessed: 10,
      runsExecuted: 25,
      workItemsCompleted: 20,
    };
    seedMeta(db, 'scheduler.metrics', JSON.stringify(saved));

    const metrics = new PersistentSchedulerMetrics(db);
    metrics.restore();

    expect(metrics.getCounters()).toEqual(saved);
  });

  it('restore() handles missing meta entry gracefully', () => {
    const metrics = new PersistentSchedulerMetrics(db);
    metrics.restore();

    expect(metrics.getCounters()).toEqual({
      goalsProcessed: 0,
      runsExecuted: 0,
      workItemsCompleted: 0,
    });
  });

  it('restore() handles malformed JSON gracefully', () => {
    seedMeta(db, 'scheduler.metrics', 'not-valid-json{{{');

    const metrics = new PersistentSchedulerMetrics(db);
    metrics.restore();

    expect(metrics.getCounters()).toEqual({
      goalsProcessed: 0,
      runsExecuted: 0,
      workItemsCompleted: 0,
    });
  });

  it('restore() handles JSON with wrong shape gracefully', () => {
    seedMeta(db, 'scheduler.metrics', JSON.stringify({ unexpected: 'shape' }));

    const metrics = new PersistentSchedulerMetrics(db);
    metrics.restore();

    expect(metrics.getCounters()).toEqual({
      goalsProcessed: 0,
      runsExecuted: 0,
      workItemsCompleted: 0,
    });
  });

  it('increment() increases counter', () => {
    const metrics = new PersistentSchedulerMetrics(db);

    metrics.increment('goalsProcessed');
    metrics.increment('goalsProcessed');
    metrics.increment('runsExecuted');
    metrics.increment('workItemsCompleted');
    metrics.increment('workItemsCompleted');
    metrics.increment('workItemsCompleted');

    expect(metrics.getCounters()).toEqual({
      goalsProcessed: 2,
      runsExecuted: 1,
      workItemsCompleted: 3,
    });
  });

  it('flush() persists counters to meta table', () => {
    const metrics = new PersistentSchedulerMetrics(db);
    metrics.increment('goalsProcessed');
    metrics.increment('runsExecuted');
    metrics.flush();

    const row = db.prepare("SELECT value FROM meta WHERE key = 'scheduler.metrics'").get() as
      | { value: string }
      | undefined;

    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.value);
    expect(parsed.goalsProcessed).toBe(1);
    expect(parsed.runsExecuted).toBe(1);
    expect(parsed.workItemsCompleted).toBe(0);
  });

  it('flush() then restore() round-trips correctly', () => {
    const m1 = new PersistentSchedulerMetrics(db);
    m1.increment('goalsProcessed');
    m1.increment('goalsProcessed');
    m1.increment('runsExecuted');
    m1.increment('workItemsCompleted');
    m1.flush();

    const m2 = new PersistentSchedulerMetrics(db);
    m2.restore();

    expect(m2.getCounters()).toEqual({
      goalsProcessed: 2,
      runsExecuted: 1,
      workItemsCompleted: 1,
    });
  });

  it('getCounters() returns a snapshot (not a reference)', () => {
    const metrics = new PersistentSchedulerMetrics(db);
    metrics.increment('goalsProcessed');

    const snapshot = metrics.getCounters();
    snapshot.goalsProcessed = 999;

    expect(metrics.getCounters().goalsProcessed).toBe(1);
  });
});
