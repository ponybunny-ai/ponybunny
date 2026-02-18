import {
  buildRecurringIdempotencyKey,
  computeCoalesceNextIntervalRun,
  DEFAULT_AGENT_CONCURRENCY,
  DEFAULT_CATCH_UP_MODE,
  resolveCatchUpPolicy,
} from '../../../src/infra/agents/scheduling-semantics.js';

describe('Scheduling semantics', () => {
  it('coalesces interval schedules when behind', () => {
    const result = computeCoalesceNextIntervalRun({
      lastScheduledForMs: 1000,
      nowMs: 5500,
      everyMs: 1000,
    });

    expect(result).toEqual({
      scheduledForMs: 5000,
      nextScheduledForMs: 6000,
    });
  });

  it('builds deterministic idempotency keys', () => {
    const key = buildRecurringIdempotencyKey('agent-a', 1234567890);
    expect(key).toBe('agent-a:1234567890');
  });

  it('defaults catch-up policy mode and leaves safety limits undefined', () => {
    const resolved = resolveCatchUpPolicy();
    expect(resolved.mode).toBe(DEFAULT_CATCH_UP_MODE);
    expect(resolved.maxCatchUpWindowMs).toBeUndefined();
    expect(resolved.maxRunsPerTick).toBeUndefined();
  });

  it('defaults agent concurrency to one in-flight run', () => {
    expect(DEFAULT_AGENT_CONCURRENCY).toBe(1);
  });
});
