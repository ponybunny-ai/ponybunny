import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { RuntimeEventStore } from '../../../src/runtime/event-bus/runtime-event-store.js';

describe('RuntimeEventStore', () => {
  let db: Database.Database;
  let store: RuntimeEventStore;

  beforeEach(() => {
    db = new Database(':memory:');
    const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));
    store = new RuntimeEventStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('appends events and lists them by goal in timestamp order', () => {
    store.append({
      id: 'evt-1',
      type: 'goal.started',
      goalId: 'goal-1',
      source: 'gateway',
      timestamp: 100,
      payload: { step: 1 },
    });
    store.append({
      id: 'evt-2',
      type: 'task.started',
      goalId: 'goal-1',
      workItemId: 'task-1',
      runId: 'run-1',
      source: 'scheduler',
      timestamp: 200,
    });
    store.append({
      id: 'evt-3',
      type: 'goal.completed',
      goalId: 'goal-2',
      source: 'gateway',
      timestamp: 300,
    });

    expect(store.listByGoal('goal-1')).toEqual([
      {
        id: 'evt-1',
        type: 'goal.started',
        goalId: 'goal-1',
        source: 'gateway',
        timestamp: 100,
        payload: { step: 1 },
      },
      {
        id: 'evt-2',
        type: 'task.started',
        goalId: 'goal-1',
        workItemId: 'task-1',
        runId: 'run-1',
        source: 'scheduler',
        timestamp: 200,
      },
    ]);
  });

  it('lists recent events in reverse chronological order', () => {
    store.append({
      id: 'evt-1',
      type: 'goal.started',
      goalId: 'goal-1',
      source: 'gateway',
      timestamp: 100,
    });
    store.append({
      id: 'evt-2',
      type: 'task.started',
      goalId: 'goal-1',
      source: 'scheduler',
      timestamp: 200,
    });
    store.append({
      id: 'evt-3',
      type: 'goal.completed',
      goalId: 'goal-1',
      source: 'gateway',
      timestamp: 300,
      payload: { ok: true },
    });

    expect(store.listRecent(2)).toEqual([
      {
        id: 'evt-3',
        type: 'goal.completed',
        goalId: 'goal-1',
        source: 'gateway',
        timestamp: 300,
        payload: { ok: true },
      },
      {
        id: 'evt-2',
        type: 'task.started',
        goalId: 'goal-1',
        source: 'scheduler',
        timestamp: 200,
      },
    ]);
  });

  it('returns recent pages in chronological order with a cursor for follow mode', () => {
    store.append({
      id: 'evt-1',
      type: 'goal.started',
      goalId: 'goal-1',
      source: 'gateway',
      timestamp: 100,
    });
    store.append({
      id: 'evt-2',
      type: 'task.started',
      goalId: 'goal-1',
      workItemId: 'task-1',
      source: 'scheduler',
      timestamp: 200,
    });
    store.append({
      id: 'evt-3',
      type: 'task.completed',
      goalId: 'goal-1',
      workItemId: 'task-1',
      source: 'scheduler',
      timestamp: 300,
    });

    expect(store.listRecentPage(2)).toEqual({
      events: [
        {
          id: 'evt-2',
          type: 'task.started',
          goalId: 'goal-1',
          workItemId: 'task-1',
          source: 'scheduler',
          timestamp: 200,
        },
        {
          id: 'evt-3',
          type: 'task.completed',
          goalId: 'goal-1',
          workItemId: 'task-1',
          source: 'scheduler',
          timestamp: 300,
        },
      ],
      cursor: {
        timestamp: 300,
        rowId: 3,
      },
    });
  });

  it('lists only events after the provided cursor, including duplicate timestamps', () => {
    store.append({
      id: 'evt-1',
      type: 'goal.started',
      goalId: 'goal-1',
      source: 'gateway',
      timestamp: 100,
    });
    store.append({
      id: 'evt-2',
      type: 'task.started',
      goalId: 'goal-1',
      workItemId: 'task-1',
      source: 'scheduler',
      timestamp: 100,
    });
    store.append({
      id: 'evt-3',
      type: 'task.completed',
      goalId: 'goal-1',
      workItemId: 'task-1',
      source: 'scheduler',
      timestamp: 200,
    });

    const page = store.listAfter({ timestamp: 100, rowId: 1 }, 10);

    expect(page).toEqual({
      events: [
        {
          id: 'evt-2',
          type: 'task.started',
          goalId: 'goal-1',
          workItemId: 'task-1',
          source: 'scheduler',
          timestamp: 100,
        },
        {
          id: 'evt-3',
          type: 'task.completed',
          goalId: 'goal-1',
          workItemId: 'task-1',
          source: 'scheduler',
          timestamp: 200,
        },
      ],
      cursor: {
        timestamp: 200,
        rowId: 3,
      },
    });
  });

  it('migrates legacy runtime_events.task_id data to work_item_id', () => {
    db.exec(`
      DROP TABLE runtime_events;
      CREATE TABLE runtime_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        task_id TEXT,
        goal_id TEXT,
        run_id TEXT,
        source TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload_json TEXT
      );
      CREATE INDEX idx_runtime_events_goal_ts ON runtime_events(goal_id, timestamp DESC);
      CREATE INDEX idx_runtime_events_recent ON runtime_events(timestamp DESC);
      INSERT INTO runtime_events (
        id, type, task_id, goal_id, run_id, source, timestamp, payload_json
      ) VALUES (
        'evt-legacy', 'task.started', 'task-legacy', 'goal-1', 'run-1', 'scheduler', 123,
        '{"taskId":"task-legacy","goalId":"goal-1"}'
      );
    `);

    store = new RuntimeEventStore(db);

    expect(store.listByGoal('goal-1')).toEqual([
      {
        id: 'evt-legacy',
        type: 'task.started',
        goalId: 'goal-1',
        workItemId: 'task-legacy',
        runId: 'run-1',
        source: 'scheduler',
        timestamp: 123,
        payload: {
          goalId: 'goal-1',
          workItemId: 'task-legacy',
        },
      },
    ]);

    const columns = db.prepare(`
      SELECT name
      FROM pragma_table_info('runtime_events')
      ORDER BY cid ASC
    `).all() as Array<{ name: string }>;

    expect(columns.map((column) => column.name)).toContain('work_item_id');
    expect(columns.map((column) => column.name)).not.toContain('task_id');
  });
});
