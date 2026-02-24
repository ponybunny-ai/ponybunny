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

jest.mock('../../src/cli/lib/openai-client.js', () => ({
  openaiClient: {
    streamChatCompletion: jest.fn(),
  },
}));

jest.mock('../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(),
  getCachedCredentials: jest.fn(() => ({ providers: {} })),
}));

jest.mock('../../src/infra/llm/provider-manager/config-loader.js', () => ({
  loadLLMConfig: jest.fn(),
}));

function sanitizeOutput(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '');
}

const originalFetch = globalThis.fetch;

describe('pb status', () => {
  afterEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  test('prints enabled providers grouped with OpenAI OAuth and OpenAI-Compatible', async () => {
    const { statusCommand } = await import('../../src/cli/commands/status.js');
    const { accountManagerV2, authManagerV2 } = await import('../../src/cli/lib/auth-manager-v2.js');
    const { openaiClient } = await import('../../src/cli/lib/openai-client.js');
    const { getCachedEndpointCredential } = await import('../../src/infra/config/credentials-loader.js');
    const { loadLLMConfig } = await import('../../src/infra/llm/provider-manager/config-loader.js');

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
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    }) as unknown as typeof fetch;
    (openaiClient.streamChatCompletion as jest.Mock).mockResolvedValue(undefined);

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
