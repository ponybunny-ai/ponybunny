jest.mock('chalk', () => {
  const chalk = {
    blue: (value: string) => value,
    red: (value: string) => value,
  };

  return {
    __esModule: true,
    default: chalk,
    ...chalk,
  };
});

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('../../src/infra/mcp/index.js', () => ({
  getMCPServerConfig: jest.fn(),
}));

describe('pb mcp inspector', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('launches inspector for stdio MCP with command and env', async () => {
    const { spawn } = await import('child_process');
    const { getMCPServerConfig } = await import('../../src/infra/mcp/index.js');
    const { createMCPCommand } = await import('../../src/cli/commands/mcp.js');

    (getMCPServerConfig as jest.Mock).mockReturnValue({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { FOO: 'bar' },
    });

    (spawn as jest.Mock).mockImplementation(() => {
      const child = {
        on: (event: string, handler: (code?: number) => void) => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return child;
        },
      };
      return child;
    });

    const command = createMCPCommand();
    await command.parseAsync(['node', 'mcp', 'inspector', 'filesystem'], { from: 'node' });

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      [
        '-y',
        '@modelcontextprotocol/inspector',
        '--transport',
        'stdio',
        '-e',
        'FOO=bar',
        'npx',
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/tmp',
      ],
      expect.objectContaining({ stdio: 'inherit', env: process.env })
    );
  });

  test('launches inspector for http MCP with url and headers', async () => {
    const { spawn } = await import('child_process');
    const { getMCPServerConfig } = await import('../../src/infra/mcp/index.js');
    const { createMCPCommand } = await import('../../src/cli/commands/mcp.js');

    (getMCPServerConfig as jest.Mock).mockReturnValue({
      transport: 'http',
      url: 'http://127.0.0.1:3000/mcp',
      headers: { Authorization: 'Bearer token' },
    });

    (spawn as jest.Mock).mockImplementation(() => {
      const child = {
        on: (event: string, handler: (code?: number) => void) => {
          if (event === 'close') {
            setImmediate(() => handler(0));
          }
          return child;
        },
      };
      return child;
    });

    const command = createMCPCommand();
    await command.parseAsync(['node', 'mcp', 'inspector', 'remote-api'], { from: 'node' });

    expect(spawn).toHaveBeenCalledWith(
      'npx',
      [
        '-y',
        '@modelcontextprotocol/inspector',
        '--transport',
        'http',
        '--server-url',
        'http://127.0.0.1:3000/mcp',
        '--header',
        'Authorization: Bearer token',
      ],
      expect.objectContaining({ stdio: 'inherit', env: process.env })
    );
  });
});
