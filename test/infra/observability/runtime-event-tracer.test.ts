import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RuntimeEventTracer } from '../../../src/infra/observability/runtime-event-tracer.js';
import type { ITracer } from '../../../src/infra/observability/tracer.js';

interface RuntimeEventRow {
  id: string;
  type: string;
  work_item_id: string | null;
  goal_id: string | null;
  run_id: string | null;
  source: string;
  timestamp: number;
  payload_json: string;
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  const schema = readFileSync(
    join(__dirname, '../../../src/infra/persistence/schema.sql'),
    'utf-8',
  );
  db.exec(schema);
  return db;
}

describe('RuntimeEventTracer', () => {
  let db: Database.Database;
  let tracer: ITracer;

  beforeEach(() => {
    db = createTestDb();
    tracer = new RuntimeEventTracer(db);
  });

  afterEach(() => {
    db.close();
  });

  it('startSpan() returns a span that can set attributes', () => {
    const span = tracer.startSpan('test.op', { initial: 'value' });
    expect(span).toBeDefined();
    expect(typeof span.setAttributes).toBe('function');
    expect(typeof span.addEvent).toBe('function');
    expect(typeof span.end).toBe('function');

    // Setting attributes should not throw
    span.setAttributes({ extra: 42 });
    span.end();
  });

  it('span.end() writes to runtime_events table', () => {
    const span = tracer.startSpan('db.query', { goalId: 'g-1' });
    span.end();

    const rows = db.prepare('SELECT * FROM runtime_events').all() as RuntimeEventRow[];
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.type).toBe('span');
    expect(row.source).toBe('db.query');
    expect(row.goal_id).toBe('g-1');
    expect(row.id).toBeDefined();
    expect(row.timestamp).toBeGreaterThan(0);

    const payload = JSON.parse(row.payload_json);
    expect(payload.status).toBe('ok');
    expect(payload.duration_ms).toBeGreaterThanOrEqual(0);
    expect(payload.attributes.goalId).toBe('g-1');
  });

  it('span.addEvent() records events in the span payload', () => {
    const span = tracer.startSpan('process.step');
    span.addEvent('checkpoint', { progress: 50 });
    span.addEvent('checkpoint', { progress: 100 });
    span.end();

    const row = db.prepare('SELECT * FROM runtime_events').get() as RuntimeEventRow;
    const payload = JSON.parse(row.payload_json);
    expect(payload.events).toHaveLength(2);
    expect(payload.events[0].name).toBe('checkpoint');
    expect(payload.events[0].attributes.progress).toBe(50);
    expect(payload.events[1].attributes.progress).toBe(100);
  });

  it('span.setAttributes() merges into existing attributes', () => {
    const span = tracer.startSpan('merge.test', { a: 1 });
    span.setAttributes({ b: 2 });
    span.setAttributes({ a: 99, c: true });
    span.end();

    const row = db.prepare('SELECT * FROM runtime_events').get() as RuntimeEventRow;
    const payload = JSON.parse(row.payload_json);
    expect(payload.attributes).toEqual({ a: 99, b: 2, c: true });
  });

  it('withSpan() auto-ends span on success with ok status', async () => {
    const result = await tracer.withSpan('auto.ok', { mode: 'test' }, async (span) => {
      span.addEvent('inside');
      return 42;
    });

    expect(result).toBe(42);

    const row = db.prepare('SELECT * FROM runtime_events').get() as RuntimeEventRow;
    const payload = JSON.parse(row.payload_json);
    expect(payload.status).toBe('ok');
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0].name).toBe('inside');
  });

  it('withSpan() auto-ends span with error status on failure', async () => {
    await expect(
      tracer.withSpan('auto.fail', { mode: 'test' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const row = db.prepare('SELECT * FROM runtime_events').get() as RuntimeEventRow;
    const payload = JSON.parse(row.payload_json);
    expect(payload.status).toBe('error');
  });

  it('duration is correctly calculated', async () => {
    const result = await tracer.withSpan('timed.op', {}, async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'done';
    });

    expect(result).toBe('done');

    const row = db.prepare('SELECT * FROM runtime_events').get() as RuntimeEventRow;
    const payload = JSON.parse(row.payload_json);
    expect(payload.duration_ms).toBeGreaterThanOrEqual(40); // allow slight timing variance
    expect(payload.start_ms).toBeLessThan(payload.end_ms);
  });

  it('attributes are serialized as JSON in payload_json', () => {
    const span = tracer.startSpan('serial.test', {
      str: 'hello',
      num: 123,
      bool: true,
    });
    span.end();

    const row = db.prepare('SELECT * FROM runtime_events').get() as RuntimeEventRow;
    const payload = JSON.parse(row.payload_json);
    expect(payload.attributes.str).toBe('hello');
    expect(payload.attributes.num).toBe(123);
    expect(payload.attributes.bool).toBe(true);
  });

  it('maps workItemId, goalId, runId from attributes to table columns', () => {
    const span = tracer.startSpan('mapped.test', {
      workItemId: 'wi-1',
      goalId: 'g-1',
      runId: 'r-1',
    });
    span.end();

    const row = db.prepare('SELECT * FROM runtime_events').get() as RuntimeEventRow;
    expect(row.work_item_id).toBe('wi-1');
    expect(row.goal_id).toBe('g-1');
    expect(row.run_id).toBe('r-1');
  });

  it('end() is idempotent -- calling twice does not insert duplicate rows', () => {
    const span = tracer.startSpan('idempotent.test');
    span.end();
    span.end();

    const rows = db.prepare('SELECT * FROM runtime_events').all();
    expect(rows).toHaveLength(1);
  });
});
