import type Database from 'better-sqlite3';

import type { EventBus } from './event-bus.js';
import type { RuntimeEvent } from './runtime-event.js';

interface RuntimeEventRow {
  id: string;
  type: string;
  task_id: string | null;
  goal_id: string | null;
  run_id: string | null;
  source: string;
  timestamp: number;
  payload_json: string | null;
}

export class RuntimeEventStore {
  constructor(private readonly db: Database.Database) {}

  append(event: RuntimeEvent): RuntimeEvent {
    this.db.prepare(`
      INSERT INTO runtime_events (
        id, type, task_id, goal_id, run_id, source, timestamp, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.type,
      event.taskId ?? null,
      event.goalId ?? null,
      event.runId ?? null,
      event.source,
      event.timestamp,
      event.payload === undefined ? null : JSON.stringify(event.payload)
    );

    return event;
  }

  listByGoal(goalId: string): RuntimeEvent[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM runtime_events
      WHERE goal_id = ?
      ORDER BY timestamp ASC, rowid ASC
    `).all(goalId) as RuntimeEventRow[];

    return rows.map((row) => this.parseRow(row));
  }

  listRecent(limit: number): RuntimeEvent[] {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
    const rows = this.db.prepare(`
      SELECT *
      FROM runtime_events
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ?
    `).all(normalizedLimit) as RuntimeEventRow[];

    return rows.map((row) => this.parseRow(row));
  }

  private parseRow(row: RuntimeEventRow): RuntimeEvent {
    return {
      id: row.id,
      type: row.type,
      source: row.source,
      timestamp: row.timestamp,
      ...(row.task_id ? { taskId: row.task_id } : {}),
      ...(row.goal_id ? { goalId: row.goal_id } : {}),
      ...(row.run_id ? { runId: row.run_id } : {}),
      ...(row.payload_json ? { payload: JSON.parse(row.payload_json) as unknown } : {}),
    };
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
