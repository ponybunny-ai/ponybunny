import { computeScheduleOutcome } from '../../../src/infra/scheduler/schedule-computation.js';

describe('schedule computation', () => {
  it('coalesces missed interval runs into a single dispatch', () => {
    const result = computeScheduleOutcome({
      schedule: {
        kind: 'interval',
        everyMs: 1000,
        catchUp: { mode: 'coalesce' },
      },
      nowMs: 5500,
      next_run_at_ms: 2000,
    });

    expect(result).toEqual({
      due: true,
      scheduled_for_ms: 5000,
      next_run_at_ms: 6000,
      coalesced_count: 3,
    });
  });

  it('returns not-due interval schedules unchanged', () => {
    const result = computeScheduleOutcome({
      schedule: {
        kind: 'interval',
        everyMs: 1000,
        catchUp: { mode: 'coalesce' },
      },
      nowMs: 1500,
      next_run_at_ms: 2000,
    });

    expect(result).toEqual({
      due: false,
      scheduled_for_ms: null,
      next_run_at_ms: 2000,
      coalesced_count: 0,
    });
  });

  it('dispatches immediately for first interval run', () => {
    const result = computeScheduleOutcome({
      schedule: {
        kind: 'interval',
        everyMs: 60000,
        catchUp: { mode: 'coalesce' },
      },
      nowMs: 1000,
    });

    expect(result).toEqual({
      due: true,
      scheduled_for_ms: 1000,
      next_run_at_ms: 61000,
      coalesced_count: 0,
    });
  });

  it('coalesces missed cron runs into a single dispatch', () => {
    const base = Date.UTC(2025, 0, 1, 0, 0, 0);
    const result = computeScheduleOutcome({
      schedule: {
        kind: 'cron',
        cron: '*/15 * * * *',
        tz: 'UTC',
        catchUp: { mode: 'coalesce' },
      },
      nowMs: base + 45 * 60 * 1000,
      next_run_at_ms: base,
    });

    expect(result).toEqual({
      due: true,
      scheduled_for_ms: base + 45 * 60 * 1000,
      next_run_at_ms: base + 60 * 60 * 1000,
      coalesced_count: 3,
    });
  });

  it('returns not-due cron schedules unchanged', () => {
    const base = Date.UTC(2025, 0, 1, 0, 0, 0);
    const result = computeScheduleOutcome({
      schedule: {
        kind: 'cron',
        cron: '*/15 * * * *',
        tz: 'UTC',
        catchUp: { mode: 'coalesce' },
      },
      nowMs: base + 5 * 60 * 1000,
      next_run_at_ms: base + 15 * 60 * 1000,
    });

    expect(result).toEqual({
      due: false,
      scheduled_for_ms: null,
      next_run_at_ms: base + 15 * 60 * 1000,
      coalesced_count: 0,
    });
  });
});
