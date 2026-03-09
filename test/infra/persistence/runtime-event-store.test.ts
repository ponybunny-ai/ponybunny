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
      taskId: 'task-1',
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
        taskId: 'task-1',
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
});
