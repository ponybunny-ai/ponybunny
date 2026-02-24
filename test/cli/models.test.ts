jest.mock('chalk', () => {
  const chalk = {
    cyan: (value: string) => value,
    white: (value: string) => value,
    green: (value: string) => value,
    red: (value: string) => value,
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
      succeed: jest.fn(),
      fail: jest.fn(),
    }),
  }),
}));

jest.mock('../../src/infra/llm/provider-manager/config-loader.js', () => ({
  loadLLMConfig: jest.fn(),
}));

jest.mock('../../src/infra/llm/endpoints/index.js', () => ({
  getAllEndpointConfigs: jest.fn(),
  hasRequiredCredentials: jest.fn(),
}));

describe('pb models list', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('shows disabled when endpoint lacks required credentials', async () => {
    const { loadLLMConfig } = await import('../../src/infra/llm/provider-manager/config-loader.js');
    const { getAllEndpointConfigs, hasRequiredCredentials } = await import('../../src/infra/llm/endpoints/index.js');
    const { modelsCommand } = await import('../../src/cli/commands/models.js');

    (loadLLMConfig as jest.Mock).mockReturnValue({
      providers: {
        'openai-direct': { enabled: true },
        'google-ai-studio': { enabled: true },
        codex: { enabled: true },
      },
      models: {},
    });

    (getAllEndpointConfigs as jest.Mock).mockReturnValue([
      { id: 'openai-direct' },
      { id: 'google-ai-studio' },
      { id: 'codex' },
    ]);

    (hasRequiredCredentials as jest.Mock).mockImplementation((endpoint: { id: string }) => endpoint.id === 'openai-direct');

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await modelsCommand.parseAsync(['node', 'models', 'list'], { from: 'node' });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('openai-direct (enabled, unknown)');
    expect(output).toContain('google-ai-studio (disabled, unknown)');
    expect(output).toContain('codex (disabled, unknown)');

    logSpy.mockRestore();
  });
});
