import {
  commands,
  findCommand,
  getCommandsByCategory,
  parseCommand,
} from '../../../../src/cli/tui/commands/registry.js';

describe('TUI command registry', () => {
  it('registers refresh command for slash menu', () => {
    const refresh = commands.find((command) => command.name === 'refresh');
    expect(refresh).toBeDefined();
    expect(refresh?.usage).toBe('/refresh [runtime] [goalId]');
  });

  it('resolves refresh by alias', () => {
    const refresh = findCommand('rf');
    expect(refresh?.name).toBe('refresh');
  });

  it('includes refresh in system category', () => {
    const categories = getCommandsByCategory();
    const systemCommands = categories.System.map((command) => command.name);
    expect(systemCommands).toContain('refresh');
    expect(systemCommands).toContain('rollout');
    expect(systemCommands).toContain('replay');
    expect(systemCommands).toContain('pruneevents');
  });

  it('resolves rollout by alias', () => {
    const rollout = findCommand('ro');
    expect(rollout?.name).toBe('rollout');
  });

  it('resolves replay by alias', () => {
    const replay = findCommand('rp');
    expect(replay?.name).toBe('replay');
  });

  it('resolves pruneevents by alias', () => {
    const prune = findCommand('pe');
    expect(prune?.name).toBe('pruneevents');
  });

  it('parses /refresh command input', () => {
    const parsed = parseCommand('/refresh');
    expect(parsed).toEqual({
      name: 'refresh',
      args: [],
      raw: '/refresh',
    });
  });
});
