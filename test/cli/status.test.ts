jest.mock('chalk', () => {
  const chalk = {
    cyan: (value: string) => value,
    white: (...values: string[]) => values.join(' '),
    green: (value: string) => value,
    red: (value: string) => value,
    yellow: (value: string) => value,
  };

  return {
    __esModule: true,
    default: chalk,
    ...chalk,
  };
});

jest.mock('../../src/cli/lib/auth-manager-v2.js', () => ({
  authManagerV2: {
    isAuthenticated: jest.fn(),
    getConfig: jest.fn(),
  },
  accountManagerV2: {
    getCurrentAccount: jest.fn(),
  },
}));

jest.mock('../../src/infra/llm/llm-service.js', () => ({
  getLLMService: jest.fn(() => ({
    complete: jest.fn(),
  })),
}));

jest.mock('../../src/infra/llm/provider-manager/openai-model-catalog.js', () => ({
  testOpenAIProtocolConnection: jest.fn(),
}));

jest.mock('../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(),
  getCachedCredentials: jest.fn(() => ({ providers: {} })),
}));

jest.mock('../../src/infra/llm/provider-manager/config-loader.js', () => ({
  loadLLMConfig: jest.fn(),
}));

jest.mock('../../src/infra/llm/endpoints/index.js', () => ({
  getAllEndpointConfigs: jest.fn(),
  hasRequiredCredentials: jest.fn(),
}));

function sanitizeOutput(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('pb status', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('prints enabled providers grouped with OpenAI OAuth and OpenAI-Compatible', async () => {
    const { statusCommand } = await import('../../src/cli/commands/status.js');
    const { accountManagerV2, authManagerV2 } = await import('../../src/cli/lib/auth-manager-v2.js');
    const { getLLMService } = await import('../../src/infra/llm/llm-service.js');
    const { testOpenAIProtocolConnection } = await import('../../src/infra/llm/provider-manager/openai-model-catalog.js');
    const { getCachedEndpointCredential } = await import('../../src/infra/config/credentials-loader.js');
    const { loadLLMConfig } = await import('../../src/infra/llm/provider-manager/config-loader.js');
    const { getAllEndpointConfigs, hasRequiredCredentials } = await import('../../src/infra/llm/endpoints/index.js');

    (loadLLMConfig as jest.Mock).mockReturnValue({
      providers: {
        'openai-compatible': { enabled: true },
        'anthropic-direct': { enabled: true },
      },
      models: {},
      tiers: {},
      workloads: {},
      defaults: {},
    });

    (authManagerV2.isAuthenticated as jest.Mock).mockReturnValue(true);
    (authManagerV2.getConfig as jest.Mock).mockReturnValue({ email: 'honeyday.mj@gmail.com' });
    (accountManagerV2.getCurrentAccount as jest.Mock).mockReturnValue({ provider: 'codex' });
    (getCachedEndpointCredential as jest.Mock).mockImplementation((endpointId: string) => {
      if (endpointId === 'openai-compatible') {
        return { apiKey: 'test-key' };
      }
      if (endpointId === 'anthropic-direct') {
        return { apiKey: 'ak-test' };
      }
      return null;
    });
    (getAllEndpointConfigs as jest.Mock).mockReturnValue([
      { id: 'openai-compatible', displayName: 'OpenAI Compatible' },
      { id: 'anthropic-direct', displayName: 'Anthropic Direct' },
    ]);
    (hasRequiredCredentials as jest.Mock).mockReturnValue(true);
    const mockComplete = jest.fn().mockResolvedValue({ content: 'OK' });
    (getLLMService as jest.Mock).mockReturnValue({ complete: mockComplete });
    (testOpenAIProtocolConnection as jest.Mock).mockResolvedValue(undefined);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await statusCommand();

    const output = sanitizeOutput(logSpy.mock.calls.map((call) => call.join(' ')).join('\n'));

    expect(output).toContain('Enabled providers: ✓ Found');
    expect(output).toContain('- OpenAI OAuth');
    expect(output).toContain('- OpenAI-Compatible');
    expect(output).toContain('- Anthropic Direct');
    expect(output).toContain('Provider: OpenAI');
    expect(output).toContain('User: honeyday.mj@gmail.com');
    expect(output).toContain('Testing enabled providers...');
    expect(output).toContain('OpenAI OAuth test successful');
    expect(output).toContain('OpenAI-Compatible test successful');
    expect(output).toContain('Anthropic Direct test successful');

    logSpy.mockRestore();
  });
});
