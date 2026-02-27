import { InMemoryDeterministicRunEventStore } from '../../src/deterministic-runtime/run-events.js';

describe('InMemoryDeterministicRunEventStore', () => {
  it('appends and lists events by run id in order', () => {
    const store = new InMemoryDeterministicRunEventStore();

    store.append({
      run_id: 'run-1',
      plan_id: 'plan-1',
      event_type: 'PLAN_COMPILE_REQUESTED',
      payload: { a: 1 },
    });
    store.append({
      run_id: 'run-1',
      plan_id: 'plan-1',
      event_type: 'PLAN_COMPILE_COMPLETED',
      payload: { ok: true },
    });

    const events = store.listByRunId('run-1');
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('PLAN_COMPILE_REQUESTED');
    expect(events[1].event_type).toBe('PLAN_COMPILE_COMPLETED');
    expect(events[0].event_id).toBeDefined();
    expect(events[0].ts_ms).toBeGreaterThan(0);
  });

  it('returns empty list for unknown run id', () => {
    const store = new InMemoryDeterministicRunEventStore();
    expect(store.listByRunId('missing')).toEqual([]);
  });
});
