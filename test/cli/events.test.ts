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

  test('registers the tail subcommand on the events command group', async () => {
    const { createEventsCommand } = await import('../../src/cli/commands/events.js');

    const command = createEventsCommand();
    expect(command.commands.map((entry) => entry.name())).toContain('tail');
  });
});
