import type Database from 'better-sqlite3';

import type { EventBus } from './event-bus.js';
import type { RuntimeEvent } from './runtime-event.js';

interface RuntimeEventRow {
  row_id: number;
  id: string;
  type: string;
  work_item_id: string | null;
  goal_id: string | null;
  run_id: string | null;
  source: string;
  timestamp: number;
  payload_json: string | null;
}

export interface RuntimeEventCursor {
  timestamp: number;
  rowId: number;
}

export interface RuntimeEventPage {
  events: RuntimeEvent[];
  cursor: RuntimeEventCursor | null;
}

export class RuntimeEventStore {
  private readonly workItemColumn: 'work_item_id' | 'task_id';

  constructor(private readonly db: Database.Database) {
    this.workItemColumn = this.ensureRuntimeEventsSchema();
  }

  append(event: RuntimeEvent): RuntimeEvent {
    this.db.prepare(`
      INSERT INTO runtime_events (
        id, type, work_item_id, goal_id, run_id, source, timestamp, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.type,
      event.workItemId ?? null,
      event.goalId ?? null,
      event.runId ?? null,
      event.source,
      event.timestamp,
      event.payload === undefined ? null : JSON.stringify(this.normalizePayload(event.payload))
    );

    return event;
  }

  listByGoal(goalId: string): RuntimeEvent[] {
    const rows = this.db.prepare(`
      SELECT
        rowid AS row_id,
        id,
        type,
        ${this.workItemColumn} AS work_item_id,
        goal_id,
        run_id,
        source,
        timestamp,
        payload_json
      FROM runtime_events
      WHERE goal_id = ?
      ORDER BY timestamp ASC, rowid ASC
    `).all(goalId) as RuntimeEventRow[];

    return rows.map((row) => this.parseRow(row));
  }

  listRecent(limit: number): RuntimeEvent[] {
    return this.listRecentPage(limit).events.slice().reverse();
  }

  listRecentPage(limit: number): RuntimeEventPage {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const rows = this.db.prepare(`
      SELECT
        rowid AS row_id,
        id,
        type,
        ${this.workItemColumn} AS work_item_id,
        goal_id,
        run_id,
        source,
        timestamp,
        payload_json
      FROM runtime_events
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ?
    `).all(normalizedLimit) as RuntimeEventRow[];

    return this.buildPage(rows.reverse());
  }

  listAfter(cursor: RuntimeEventCursor | null, limit: number): RuntimeEventPage {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const rows = cursor
      ? this.db.prepare(`
          SELECT
            rowid AS row_id,
            id,
            type,
            ${this.workItemColumn} AS work_item_id,
            goal_id,
            run_id,
            source,
            timestamp,
            payload_json
          FROM runtime_events
          WHERE timestamp > ?
             OR (timestamp = ? AND rowid > ?)
          ORDER BY timestamp ASC, rowid ASC
          LIMIT ?
        `).all(cursor.timestamp, cursor.timestamp, cursor.rowId, normalizedLimit) as RuntimeEventRow[]
      : this.db.prepare(`
          SELECT
            rowid AS row_id,
            id,
            type,
            ${this.workItemColumn} AS work_item_id,
            goal_id,
            run_id,
            source,
            timestamp,
            payload_json
          FROM runtime_events
          ORDER BY timestamp ASC, rowid ASC
          LIMIT ?
        `).all(normalizedLimit) as RuntimeEventRow[];

    return this.buildPage(rows);
  }

  private parseRow(row: RuntimeEventRow): RuntimeEvent {
    const payload = row.payload_json ? JSON.parse(row.payload_json) as unknown : undefined;

    return {
      id: row.id,
      type: row.type,
      source: row.source,
      timestamp: row.timestamp,
      ...(row.work_item_id ? { workItemId: row.work_item_id } : {}),
      ...(row.goal_id ? { goalId: row.goal_id } : {}),
      ...(row.run_id ? { runId: row.run_id } : {}),
      ...(payload !== undefined ? { payload: this.normalizePayload(payload) } : {}),
    };
  }

  private buildPage(rows: RuntimeEventRow[]): RuntimeEventPage {
    const cursor = rows.length > 0
      ? {
          timestamp: rows[rows.length - 1].timestamp,
          rowId: rows[rows.length - 1].row_id,
        }
      : null;

    return {
      events: rows.map((row) => this.parseRow(row)),
      cursor,
    };
  }

  private ensureRuntimeEventsSchema(): 'work_item_id' | 'task_id' {
    const columns = this.db.prepare(`
      SELECT name
      FROM pragma_table_info('runtime_events')
    `).all() as Array<{ name: string }>;

    const hasWorkItemId = columns.some((column) => column.name === 'work_item_id');
    if (hasWorkItemId) {
      return 'work_item_id';
    }

    const hasTaskId = columns.some((column) => column.name === 'task_id');
    if (!hasTaskId) {
      return 'work_item_id';
    }

    try {
      this.db.exec(`
        BEGIN;
        CREATE TABLE runtime_events__migration (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          work_item_id TEXT,
          goal_id TEXT,
          run_id TEXT,
          source TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          payload_json TEXT
        );
        INSERT INTO runtime_events__migration (
          id, type, work_item_id, goal_id, run_id, source, timestamp, payload_json
        )
        SELECT
          id, type, task_id, goal_id, run_id, source, timestamp, payload_json
        FROM runtime_events;
        DROP TABLE runtime_events;
        ALTER TABLE runtime_events__migration RENAME TO runtime_events;
        CREATE INDEX IF NOT EXISTS idx_runtime_events_goal_ts ON runtime_events(goal_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_runtime_events_recent ON runtime_events(timestamp DESC);
        COMMIT;
      `);

      return 'work_item_id';
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Ignore rollback failures so read-only callers can still fall back.
      }

      return 'task_id';
    }
  }

  private normalizePayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    const sample = payload as Record<string, unknown>;
    const workItemId = this.readString(sample.workItemId) ?? this.readString(sample.taskId);
    if (!workItemId) {
      return payload;
    }

    const { taskId: _taskId, ...rest } = sample;

    return { ...rest, workItemId };
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

export interface RuntimeEventStoreBinding {
  stop(): Promise<void>;
}

/**
 * Runtime event persistence is buffered off the publish call stack so the
 * mirrored event stream does not add synchronous latency to the adapters.
 */
export function attachRuntimeEventStore(
  bus: EventBus,
  store: RuntimeEventStore
): RuntimeEventStoreBinding {
  const queue: RuntimeEvent[] = [];
  let scheduled = false;
  let draining = false;
  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  let resolveStop: (() => void) | null = null;

  const finishStopIfIdle = (): void => {
    if (stopping && !scheduled && !draining && queue.length === 0) {
      resolveStop?.();
      resolveStop = null;
      stopPromise = null;
    }
  };

  const drainQueue = (): void => {
    scheduled = false;
    if (draining) {
      return;
    }

    draining = true;

    try {
      while (queue.length > 0) {
        const event = queue.shift();
        if (!event) {
          continue;
        }

        try {
          store.append(event);
        } catch (error) {
          console.error(`[RuntimeEventStore] Failed to persist '${event.type}' (${event.id}):`, error);
        }
      }
    } finally {
      draining = false;

      if (queue.length > 0) {
        scheduleDrain();
      } else {
        finishStopIfIdle();
      }
    }
  };

  const scheduleDrain = (): void => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    setImmediate(drainQueue);
  };

  const unsubscribe = bus.subscribeAll((event) => {
    queue.push(event);
    scheduleDrain();
  });

  return {
    async stop(): Promise<void> {
      unsubscribe();
      stopping = true;

      if (!scheduled && !draining && queue.length === 0) {
        finishStopIfIdle();
        return;
      }

      if (!stopPromise) {
        stopPromise = new Promise<void>((resolve) => {
          resolveStop = resolve;
        });
      }

      await stopPromise;
    },
  };
}
