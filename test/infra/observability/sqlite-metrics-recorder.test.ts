import Database from 'better-sqlite3';
import { SQLiteMetricsRecorder } from '../../../src/infra/observability/sqlite-metrics-recorder.js';
import { NoopMetricsRecorder } from '../../../src/infra/observability/metrics.js';

describe('SQLiteMetricsRecorder', () => {
  let db: Database.Database;
  let recorder: SQLiteMetricsRecorder;

  beforeEach(() => {
    db = new Database(':memory:');
    recorder = new SQLiteMetricsRecorder(db);
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getCounter(name: string, labels = '{}'): { value: number; updated_at: number } | undefined {
    return db
      .prepare('SELECT value, updated_at FROM metric_counters WHERE name = ? AND labels = ?')
      .get(name, labels) as { value: number; updated_at: number } | undefined;
  }

  function getSamples(name: string): Array<{ value: number; labels: string; recorded_at: number }> {
    return db
      .prepare('SELECT value, labels, recorded_at FROM metric_samples WHERE name = ? ORDER BY recorded_at')
      .all(name) as Array<{ value: number; labels: string; recorded_at: number }>;
  }

  // ---------------------------------------------------------------------------
  // increment()
  // ---------------------------------------------------------------------------

  it('increment() creates a new counter with value 1', () => {
    recorder.increment('goal.completed');
    const row = getCounter('goal.completed');
    expect(row).toBeDefined();
    expect(row!.value).toBe(1);
  });

  it('increment() increments an existing counter', () => {
    recorder.increment('run.success');
    recorder.increment('run.success');
    recorder.increment('run.success');
    const row = getCounter('run.success');
    expect(row!.value).toBe(3);
  });

  it('increment() with labels keeps counters separate', () => {
    recorder.increment('run.success', { agent: 'alpha' });
    recorder.increment('run.success', { agent: 'beta' });
    recorder.increment('run.success', { agent: 'alpha' });

    const alpha = getCounter('run.success', JSON.stringify({ agent: 'alpha' }));
    const beta = getCounter('run.success', JSON.stringify({ agent: 'beta' }));
    expect(alpha!.value).toBe(2);
    expect(beta!.value).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // recordDuration()
  // ---------------------------------------------------------------------------

  it('recordDuration() inserts a sample row', () => {
    recorder.recordDuration('llm.call.duration', 123.45);
    const samples = getSamples('llm.call.duration');
    expect(samples).toHaveLength(1);
    expect(samples[0].value).toBe(123.45);
  });

  it('recordDuration() inserts multiple independent samples', () => {
    recorder.recordDuration('tool.execution.duration', 10);
    recorder.recordDuration('tool.execution.duration', 20);
    recorder.recordDuration('tool.execution.duration', 30);
    const samples = getSamples('tool.execution.duration');
    expect(samples).toHaveLength(3);
    expect(samples.map((s) => s.value)).toEqual([10, 20, 30]);
  });

  // ---------------------------------------------------------------------------
  // gauge()
  // ---------------------------------------------------------------------------

  it('gauge() sets a value', () => {
    recorder.gauge('circuit_breaker.opened', 1);
    const row = getCounter('circuit_breaker.opened');
    expect(row!.value).toBe(1);
  });

  it('gauge() replaces existing value (does not accumulate)', () => {
    recorder.gauge('circuit_breaker.opened', 5);
    recorder.gauge('circuit_breaker.opened', 3);
    const row = getCounter('circuit_breaker.opened');
    expect(row!.value).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Label serialization
  // ---------------------------------------------------------------------------

  it('labels are serialized in sorted key order', () => {
    recorder.increment('goal.completed', { z: '1', a: '2' });
    // Sorted: {"a":"2","z":"1"}
    const row = getCounter('goal.completed', JSON.stringify({ a: '2', z: '1' }));
    expect(row).toBeDefined();
    expect(row!.value).toBe(1);
  });

  it('empty labels default to "{}"', () => {
    recorder.increment('goal.completed');
    recorder.increment('goal.completed', {});
    const row = getCounter('goal.completed', '{}');
    expect(row!.value).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Table safety — constructor creates tables if missing
  // ---------------------------------------------------------------------------

  it('constructor creates tables on a fresh database', () => {
    const freshDb = new Database(':memory:');
    // Should not throw
    const rec = new SQLiteMetricsRecorder(freshDb);
    rec.increment('test.metric');
    const row = freshDb
      .prepare("SELECT value FROM metric_counters WHERE name = 'test.metric'")
      .get() as { value: number };
    expect(row.value).toBe(1);
    freshDb.close();
  });
});

// ---------------------------------------------------------------------------
// NoopMetricsRecorder smoke test
// ---------------------------------------------------------------------------

describe('NoopMetricsRecorder', () => {
  it('all methods are callable no-ops', () => {
    const noop = new NoopMetricsRecorder();
    expect(() => {
      noop.increment('goal.completed');
      noop.recordDuration('llm.call.duration', 100);
      noop.gauge('circuit_breaker.opened', 1);
    }).not.toThrow();
  });
});
