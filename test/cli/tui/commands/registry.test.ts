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
    expect(refresh?.usage).toBe('/refresh');
  });

  it('resolves refresh by alias', () => {
    const refresh = findCommand('rf');
    expect(refresh?.name).toBe('refresh');
  });

  it('includes refresh in system category', () => {
    const categories = getCommandsByCategory();
    const systemCommands = categories.System.map((command) => command.name);
    expect(systemCommands).toContain('refresh');
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
