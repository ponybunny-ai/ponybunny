import { MemoryEventBus } from '../../../src/runtime/event-bus/memory-event-bus.js';
import { RuntimeEventStore, attachRuntimeEventStore } from '../../../src/runtime/event-bus/runtime-event-store.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

describe('MemoryEventBus', () => {
  it('notifies subscribeAll handlers for published events', async () => {
    const bus = new MemoryEventBus();
    const handler = jest.fn();

    bus.subscribeAll(handler);

    await bus.publish({
      id: 'evt-1',
      type: 'goal.started',
      goalId: 'goal-1',
      source: 'gateway',
      timestamp: 100,
    });

    expect(handler).toHaveBeenCalledWith({
      id: 'evt-1',
      type: 'goal.started',
      goalId: 'goal-1',
      source: 'gateway',
      timestamp: 100,
    });
  });

  it('allows attachRuntimeEventStore to persist published events asynchronously', async () => {
    const db = new Database(':memory:');
    const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));

    const bus = new MemoryEventBus();
    const store = new RuntimeEventStore(db);
    const binding = attachRuntimeEventStore(bus, store);

    await bus.publish({
      id: 'evt-async-1',
      type: 'goal.started',
      goalId: 'goal-async-1',
      source: 'gateway',
      timestamp: 100,
      payload: { ok: true },
    });

    await binding.stop();

    expect(store.listByGoal('goal-async-1')).toEqual([
      {
        id: 'evt-async-1',
        type: 'goal.started',
        goalId: 'goal-async-1',
        source: 'gateway',
        timestamp: 100,
        payload: { ok: true },
      },
    ]);

    db.close();
  });
});
