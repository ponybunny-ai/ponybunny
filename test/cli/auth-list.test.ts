jest.mock('chalk', () => {
  const chalk = {
    cyan: (value: string) => value,
    white: (...values: string[]) => values.join(' '),
    green: (value: string) => value,
    red: (value: string) => value,
    yellow: Object.assign((value: string) => value, { bold: (value: string) => value }),
    blue: { bold: (value: string) => value },
    magenta: { bold: (value: string) => value },
    bold: (value: string) => value,
    gray: (value: string) => value,
  };

  return {
    __esModule: true,
    default: chalk,
    ...chalk,
  };
});

jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: () => ({
      text: '',
      fail: () => undefined,
      succeed: () => undefined,
    }),
  }),
}));

jest.mock('open', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('inquirer', () => ({
  __esModule: true,
  default: {
    prompt: jest.fn(),
  },
}));

jest.mock('../../src/cli/lib/auth-manager-v2.js', () => ({
  accountManagerV2: {
    listAccounts: jest.fn(),
    getConfig: jest.fn(),
    isAuthenticated: jest.fn(),
  },
}));

jest.mock('../../src/infra/llm/endpoints/index.js', () => ({
  getAllEndpointConfigs: jest.fn(),
}));

jest.mock('../../src/infra/config/credentials-loader.js', () => ({
  getCachedCredentials: jest.fn(),
}));

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('pb auth list', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('shows enabled provider groups including OpenAI-Compatible and other enabled providers', async () => {
    const { listAccounts } = await import('../../src/cli/commands/auth.js');
    const { accountManagerV2 } = await import('../../src/cli/lib/auth-manager-v2.js');
    const { getAllEndpointConfigs } = await import('../../src/infra/llm/endpoints/index.js');
    const { getCachedCredentials } = await import('../../src/infra/config/credentials-loader.js');

    (accountManagerV2.listAccounts as jest.Mock).mockReturnValue([]);
    (accountManagerV2.getConfig as jest.Mock).mockReturnValue({ strategy: 'round-robin', currentAccountId: undefined });
    (accountManagerV2.isAuthenticated as jest.Mock).mockReturnValue(true);

    (getAllEndpointConfigs as jest.Mock).mockReturnValue([
      { id: 'codex', displayName: 'OpenAI Codex (OAuth)' },
      { id: 'openai-compatible', displayName: 'OpenAI Compatible' },
      { id: 'anthropic-direct', displayName: 'Anthropic Direct' },
    ]);

    (getCachedCredentials as jest.Mock).mockReturnValue({
      endpoints: {
        'openai-compatible': {
          enabled: true,
          apiKey: 'openai-compatible-1234567890',
        },
        'anthropic-direct': {
          enabled: true,
          apiKey: 'anthropic-direct-1234567890',
        },
        'azure-openai': {
          enabled: false,
          apiKey: 'azure-should-not-show',
        },
      },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await listAccounts();

    const output = stripAnsi(logSpy.mock.calls.map((call) => call.join(' ')).join('\n'));
    expect(output).toContain('Enabled providers: ✓ Found');
    expect(output).toContain('- OpenAI OAuth');
    expect(output).toContain('- OpenAI-Compatible');
    expect(output).toContain('- Anthropic Direct');
    expect(output).toContain('API Key: openai-compatib***');
    expect(output).toContain('API Key: anthropic-direc***');
    expect(output).not.toContain('azure-should-not-show');
    expect(output).not.toContain('Accounts:');

    logSpy.mockRestore();
  });
});
