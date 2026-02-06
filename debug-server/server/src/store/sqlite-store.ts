/**
 * SQLite implementation of IDebugDataStore.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { IDebugDataStore } from './types.js';
import type {
  EnrichedEvent,
  EventFilter,
  CachedGoal,
  CachedWorkItem,
  CachedRun,
  AggregatedMetrics,
  GoalFilter,
  TimeRange,
} from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface EventRow {
  id: string;
  timestamp: number;
  type: string;
  source: string;
  goal_id: string | null;
  work_item_id: string | null;
  run_id: string | null;
  data: string;
  created_at: number;
}

interface GoalRow {
  id: string;
  status: string;
  title: string | null;
  data: string;
  updated_at: number;
}

interface WorkItemRow {
  id: string;
  goal_id: string;
  status: string;
  title: string | null;
  data: string;
  updated_at: number;
}

interface RunRow {
  id: string;
  work_item_id: string;
  status: string;
  data: string;
  updated_at: number;
}

interface MetricsRow {
  id: number;
  window_start: number;
  window_end: number;
  data: string;
}

export class SQLiteDebugStore implements IDebugDataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  // ========== Event Storage ==========

  saveEvent(event: EnrichedEvent): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (id, timestamp, type, source, goal_id, work_item_id, run_id, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.timestamp,
      event.type,
      event.source,
      event.goalId ?? null,
      event.workItemId ?? null,
      event.runId ?? null,
      JSON.stringify(event.data)
    );
  }

  queryEvents(filter: EventFilter): EnrichedEvent[] {
    let query = 'SELECT * FROM events WHERE 1=1';
    const params: unknown[] = [];

    if (filter.type) {
      // Support prefix matching with LIKE
      if (filter.type.endsWith('*')) {
        query += ' AND type LIKE ?';
        params.push(filter.type.slice(0, -1) + '%');
      } else {
        query += ' AND type = ?';
        params.push(filter.type);
      }
    }

    if (filter.source) {
      query += ' AND source = ?';
      params.push(filter.source);
    }

    if (filter.goalId) {
      query += ' AND goal_id = ?';
      params.push(filter.goalId);
    }

    if (filter.workItemId) {
      query += ' AND work_item_id = ?';
      params.push(filter.workItemId);
    }

    if (filter.runId) {
      query += ' AND run_id = ?';
      params.push(filter.runId);
    }

    if (filter.startTime !== undefined) {
      query += ' AND timestamp >= ?';
      params.push(filter.startTime);
    }

    if (filter.endTime !== undefined) {
      query += ' AND timestamp <= ?';
      params.push(filter.endTime);
    }

    query += ' ORDER BY timestamp DESC';

    if (filter.limit !== undefined) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter.offset !== undefined) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as EventRow[];

    return rows.map((row) => this.parseEventRow(row));
  }

  getEventCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM events');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  private parseEventRow(row: EventRow): EnrichedEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      type: row.type,
      source: row.source,
      data: JSON.parse(row.data),
      goalId: row.goal_id ?? undefined,
      workItemId: row.work_item_id ?? undefined,
      runId: row.run_id ?? undefined,
    };
  }

  // ========== Entity Cache ==========

  upsertGoal(goal: CachedGoal): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO goals (id, status, title, data, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      goal.id,
      goal.status,
      goal.title ?? null,
      JSON.stringify(goal.data),
      goal.updatedAt
    );
  }

  upsertWorkItem(workItem: CachedWorkItem): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO work_items (id, goal_id, status, title, data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      workItem.id,
      workItem.goalId,
      workItem.status,
      workItem.title ?? null,
      JSON.stringify(workItem.data),
      workItem.updatedAt
    );
  }

  upsertRun(run: CachedRun): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO runs (id, work_item_id, status, data, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      run.workItemId,
      run.status,
      JSON.stringify(run.data),
      run.updatedAt
    );
  }

  getGoal(id: string): CachedGoal | null {
    const stmt = this.db.prepare('SELECT * FROM goals WHERE id = ?');
    const row = stmt.get(id) as GoalRow | undefined;

    if (!row) {
      return null;
    }

    return this.parseGoalRow(row);
  }

  getGoals(filter?: GoalFilter): CachedGoal[] {
    let query = 'SELECT * FROM goals WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }

    query += ' ORDER BY updated_at DESC';

    if (filter?.limit !== undefined) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter?.offset !== undefined) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as GoalRow[];

    return rows.map((row) => this.parseGoalRow(row));
  }

  getWorkItems(goalId?: string): CachedWorkItem[] {
    let query = 'SELECT * FROM work_items';
    const params: unknown[] = [];

    if (goalId) {
      query += ' WHERE goal_id = ?';
      params.push(goalId);
    }

    query += ' ORDER BY updated_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as WorkItemRow[];

    return rows.map((row) => this.parseWorkItemRow(row));
  }

  getRuns(workItemId?: string): CachedRun[] {
    let query = 'SELECT * FROM runs';
    const params: unknown[] = [];

    if (workItemId) {
      query += ' WHERE work_item_id = ?';
      params.push(workItemId);
    }

    query += ' ORDER BY updated_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as RunRow[];

    return rows.map((row) => this.parseRunRow(row));
  }

  private parseGoalRow(row: GoalRow): CachedGoal {
    return {
      id: row.id,
      status: row.status,
      title: row.title ?? undefined,
      data: JSON.parse(row.data),
      updatedAt: row.updated_at,
    };
  }

  private parseWorkItemRow(row: WorkItemRow): CachedWorkItem {
    return {
      id: row.id,
      goalId: row.goal_id,
      status: row.status,
      title: row.title ?? undefined,
      data: JSON.parse(row.data),
      updatedAt: row.updated_at,
    };
  }

  private parseRunRow(row: RunRow): CachedRun {
    return {
      id: row.id,
      workItemId: row.work_item_id,
      status: row.status,
      data: JSON.parse(row.data),
      updatedAt: row.updated_at,
    };
  }

  // ========== Aggregated Data ==========

  saveMetrics(metrics: AggregatedMetrics): void {
    const stmt = this.db.prepare(`
      INSERT INTO metrics (window_start, window_end, data)
      VALUES (?, ?, ?)
    `);

    stmt.run(
      metrics.windowStart,
      metrics.windowEnd,
      JSON.stringify(metrics.data)
    );
  }

  queryMetrics(timeRange: TimeRange): AggregatedMetrics[] {
    const stmt = this.db.prepare(`
      SELECT * FROM metrics
      WHERE window_start >= ? AND window_end <= ?
      ORDER BY window_start ASC
    `);

    const rows = stmt.all(timeRange.start, timeRange.end) as MetricsRow[];

    return rows.map((row) => ({
      windowStart: row.window_start,
      windowEnd: row.window_end,
      data: JSON.parse(row.data),
    }));
  }

  // ========== Maintenance ==========

  cleanupOldEvents(retentionDays: number): number {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare('DELETE FROM events WHERE timestamp < ?');
    const result = stmt.run(cutoffTime);

    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
