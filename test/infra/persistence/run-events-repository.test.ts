import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';

function createTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-run-events-'));
  return path.join(dir, 'pony.db');
}

describe('WorkOrderDatabase run events persistence', () => {
  it('appends and lists run events in stable order', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const first = repository.appendRunEvent!({
      run_id: 'run-1',
      plan_id: 'plan-1',
      event_type: 'PLAN_COMPILE_REQUESTED',
      payload: { source: 'test' },
    });
    const second = repository.appendRunEvent!({
      run_id: 'run-1',
      plan_id: 'plan-1',
      event_type: 'PLAN_COMPILE_COMPLETED',
      payload: { ok: true },
    });

    const events = repository.listRunEvents!({ run_id: 'run-1' });
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('PLAN_COMPILE_REQUESTED');
    expect(events[1].event_type).toBe('PLAN_COMPILE_COMPLETED');
    expect(events[0].event_id).toBe(first.event_id);
    expect(events[1].event_id).toBe(second.event_id);
    expect(events[0].sequence).toBeLessThan(events[1].sequence ?? 0);

    repository.close();
  });

  it('supports event_type filtering and limit', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    repository.appendRunEvent!({
      run_id: 'run-2',
      event_type: 'PLAN_COMPILE_REQUESTED',
      payload: {},
    });
    repository.appendRunEvent!({
      run_id: 'run-2',
      event_type: 'PLAN_COMPILE_FAILED',
      payload: { error_count: 1 },
    });
    repository.appendRunEvent!({
      run_id: 'run-2',
      event_type: 'RUN_CREATED',
      payload: {},
    });

    const filtered = repository.listRunEvents!({
      run_id: 'run-2',
      event_types: ['PLAN_COMPILE_FAILED'],
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].event_type).toBe('PLAN_COMPILE_FAILED');

    const limited = repository.listRunEvents!({ run_id: 'run-2', limit: 2 });
    expect(limited).toHaveLength(2);

    const paged = repository.listRunEvents!({ run_id: 'run-2', limit: 1, offset: 1 });
    expect(paged).toHaveLength(1);
    expect(paged[0].event_type).toBe('PLAN_COMPILE_FAILED');

    const aggregated = repository.listRunEvents!({
      run_ids: ['run-1', 'run-2'],
    });
    expect(aggregated.length).toBeGreaterThanOrEqual(3);

    repository.close();
  });

  it('returns empty for listRunEvents without run_id/run_ids', async () => {
    const dbPath = createTempDbPath();
    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    const events = repository.listRunEvents!({});
    expect(events).toEqual([]);

    repository.close();
  });

  it('keeps run events readable after repository re-open', async () => {
    const dbPath = createTempDbPath();

    const writer = new WorkOrderDatabase(dbPath);
    await writer.initialize();
    writer.appendRunEvent!({
      run_id: 'run-reopen-1',
      plan_id: 'plan-reopen-1',
      event_type: 'PLAN_COMPILE_REQUESTED',
      payload: { source: 'reopen-test' },
    });
    writer.appendRunEvent!({
      run_id: 'run-reopen-1',
      plan_id: 'plan-reopen-1',
      event_type: 'PLAN_COMPILE_COMPLETED',
      payload: { ok: true },
    });
    writer.close();

    const reader = new WorkOrderDatabase(dbPath);
    await reader.initialize();
    const events = reader.listRunEvents!({ run_id: 'run-reopen-1' });

    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('PLAN_COMPILE_REQUESTED');
    expect(events[1].event_type).toBe('PLAN_COMPILE_COMPLETED');
    expect(events[0].sequence).toBeLessThan(events[1].sequence ?? 0);

    reader.close();
  });
});
