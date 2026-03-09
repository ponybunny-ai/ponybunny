jest.mock('chalk', () => {
  const chalk = {
    red: (value: string) => value,
  };

  return {
    __esModule: true,
    default: chalk,
    ...chalk,
  };
});

describe('pb events', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('formats runtime events using the operator-facing tail layout', async () => {
    const { formatRuntimeEventLine } = await import('../../src/cli/commands/events.js');

    expect(
      formatRuntimeEventLine({
        id: 'evt-1',
        type: 'task.started',
        goalId: 'goal-1',
        source: 'scheduler',
        timestamp: Date.UTC(2026, 2, 9, 12, 34, 56, 789),
      })
    ).toBe('2026-03-09T12:34:56.789Z | task.started | goal-1 | - | scheduler');
  });

  test('formats runtime events for replay with a compact payload summary', async () => {
    const { formatRuntimeReplayLine } = await import('../../src/cli/commands/events.js');

    expect(
      formatRuntimeReplayLine({
        id: 'evt-2',
        type: 'run.completed',
        goalId: 'goal-1',
        workItemId: 'task-1',
        runId: 'run-1',
        source: 'scheduler',
        timestamp: Date.UTC(2026, 2, 9, 12, 35, 0, 0),
        payload: {
          goalId: 'goal-1',
          runId: 'run-1',
          status: 'completed',
          tokensUsed: 1234,
          costUsd: 0.42,
          details: { model: 'gpt-5' },
        },
      })
    ).toBe(
      '2026-03-09T12:35:00.000Z | run.completed | task-1 | run-1 | scheduler | status=completed, tokensUsed=1234, costUsd=0.42, details={model}'
    );
  });

  test('registers the tail and replay subcommands on the events command group', async () => {
    const { createEventsCommand } = await import('../../src/cli/commands/events.js');

    const command = createEventsCommand();
    expect(command.commands.map((entry) => entry.name())).toEqual(
      expect.arrayContaining(['tail', 'replay'])
    );
  });
});
