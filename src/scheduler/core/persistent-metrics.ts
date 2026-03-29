/**
 * PersistentSchedulerMetrics — ADR-002 Phase D3
 *
 * Persists scheduler counters across process restarts using the meta table.
 * All operations are synchronous (better-sqlite3).
 */

import type Database from 'better-sqlite3';

export interface SchedulerCounters {
  goalsProcessed: number;
  runsExecuted: number;
  workItemsCompleted: number;
}

const META_KEY = 'scheduler.metrics';

const ZERO_COUNTERS: SchedulerCounters = {
  goalsProcessed: 0,
  runsExecuted: 0,
  workItemsCompleted: 0,
};

export class PersistentSchedulerMetrics {
  private counters: SchedulerCounters = { ...ZERO_COUNTERS };

  private readonly readStmt: Database.Statement;
  private readonly writeStmt: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.readStmt = this.db.prepare(
      'SELECT value FROM meta WHERE key = ?'
    );
    this.writeStmt = this.db.prepare(
      'INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES (?, ?, ?)'
    );
  }

  /**
   * Restore counters from the meta table.
   * If no entry exists or JSON is malformed, counters stay at zero.
   */
  restore(): void {
    const row = this.readStmt.get(META_KEY) as { value: string } | undefined;
    if (!row) return;

    try {
      const parsed = JSON.parse(row.value);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof parsed.goalsProcessed === 'number' &&
        typeof parsed.runsExecuted === 'number' &&
        typeof parsed.workItemsCompleted === 'number'
      ) {
        this.counters = {
          goalsProcessed: parsed.goalsProcessed,
          runsExecuted: parsed.runsExecuted,
          workItemsCompleted: parsed.workItemsCompleted,
        };
      }
    } catch {
      // Malformed JSON — keep zero counters
    }
  }

  /**
   * Increment an in-memory counter by one.
   */
  increment(key: keyof SchedulerCounters): void {
    this.counters[key]++;
  }

  /**
   * Flush current counters to the meta table (UPSERT).
   */
  flush(): void {
    this.writeStmt.run(
      META_KEY,
      JSON.stringify(this.counters),
      Date.now()
    );
  }

  /**
   * Return a snapshot of the current in-memory counters.
   */
  getCounters(): SchedulerCounters {
    return { ...this.counters };
  }
}
