import { AgentATickRunner } from '../../src/scheduler-daemon/agent-a-loop.js';

describe('AgentATickRunner', () => {
  test('runs ticks on interval and stops cleanly', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const calls: string[] = [];
    const runner = new AgentATickRunner({
      intervalMs: 1000,
      tick: async (input) => {
        calls.push(input.run_id);
      },
      inputFactory: (now) => ({
        run_id: now.toISOString(),
        now: now.toISOString(),
        max_sources_per_tick: 1,
        max_items_per_source: 1,
        default_time_window: '1h',
      }),
    });

    runner.start();
    await Promise.resolve();

    expect(calls.length).toBe(1);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(calls.length).toBe(2);

    await runner.stop();
    jest.useRealTimers();
  });
});
