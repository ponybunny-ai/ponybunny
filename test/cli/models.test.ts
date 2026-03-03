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

jest.mock('../../src/infra/llm/provider-manager/index.js', () => ({
  getLLMProviderManager: jest.fn(),
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
    expect(output).toContain('openai-direct (enabled');
    expect(output).toContain('google-ai-studio (enabled');
    expect(output).toContain('codex (enabled');

    logSpy.mockRestore();
  });

  test('hides disabled providers by default and shows all with --all', async () => {
    const { loadLLMConfig } = await import('../../src/infra/llm/provider-manager/config-loader.js');
    const { getAllEndpointConfigs, hasRequiredCredentials } = await import('../../src/infra/llm/endpoints/index.js');
    const { modelsCommand } = await import('../../src/cli/commands/models.js');

    (loadLLMConfig as jest.Mock).mockReturnValue({
      providers: {
        openai: { enabled: true },
        'azure-openai': { enabled: false },
      },
      models: {
        'openai.gpt-5.2': { displayName: 'GPT-5.2' },
        'azure-openai.gpt-4o': { displayName: 'GPT-4o' },
      },
    });

    (getAllEndpointConfigs as jest.Mock).mockReturnValue([
      { id: 'openai' },
      { id: 'azure-openai' },
    ]);
    (hasRequiredCredentials as jest.Mock).mockReturnValue(true);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await modelsCommand.parseAsync(['node', 'models', 'list'], { from: 'node' });
    const defaultOutput = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(defaultOutput).toContain('openai (enabled');
    expect(defaultOutput).toContain('openai.gpt-5.2');
    expect(defaultOutput).not.toContain('azure-openai (disabled');

    logSpy.mockClear();

    await modelsCommand.parseAsync(['node', 'models', 'list', '--all'], { from: 'node' });
    const allOutput = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(allOutput).toContain('openai (enabled');
    expect(allOutput).toContain('azure-openai (disabled');
    expect(allOutput).toContain('azure-openai.gpt-4o');

    logSpy.mockRestore();
  });
});

describe('pb models test', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('buildModelTestMetadata computes first-token latency and token fields', async () => {
    const { buildModelTestMetadata } = await import('../../src/cli/commands/models.js');

    const metadata = buildModelTestMetadata(
      1000,
      1200,
      {
        inputTokens: 7,
        outputTokens: 35,
        totalTokens: 42,
      },
      0.00123
    );
    expect(metadata.requestedAt).toBe(new Date(1000).toISOString());
    expect(metadata.firstTokenLatencyMs).toBe(200);
    expect(metadata.inputTokens).toBe(7);
    expect(metadata.outputTokens).toBe(35);
    expect(metadata.totalTokens).toBe(42);
    expect(metadata.estimatedCostUsd).toBe(0.00123);
  });

  test('buildModelTestMetadata keeps null latency when no chunk arrives', async () => {
    const { buildModelTestMetadata } = await import('../../src/cli/commands/models.js');

    const metadata = buildModelTestMetadata(
      1000,
      null,
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      null
    );
    expect(metadata.firstTokenLatencyMs).toBeNull();
    expect(metadata.totalTokens).toBe(0);
    expect(metadata.estimatedCostUsd).toBeNull();
  });

  test('runModelTestTurn returns error and rolls back user turn on request failure', async () => {
    const { runModelTestTurn } = await import('../../src/cli/commands/models.js');

    const manager = {
      completeWithModel: jest.fn(async () => {
        throw new Error('Bad Gateway');
      }),
      estimateCost: jest.fn(() => 0),
    };

    const messages = [{ role: 'assistant', content: 'previous' }] as Array<{ role: 'user' | 'assistant'; content: string }>;
    const turn = await runModelTestTurn(
      manager,
      'CPA.gpt-5.2',
      messages,
      'hi',
      () => undefined
    );

    expect(turn.ok).toBe(false);
    expect(turn.errorMessage).toContain('Bad Gateway');
    expect(messages).toEqual([{ role: 'assistant', content: 'previous' }]);
  });

  test('runModelTestTurn returns metadata and appends assistant turn on success', async () => {
    const { runModelTestTurn } = await import('../../src/cli/commands/models.js');

    const manager = {
      completeWithModel: jest.fn(async (_model: string, _messages: unknown, options: { onChunk?: (chunk: string) => void }) => {
        options.onChunk?.('hello');
        return {
          content: 'hello',
          tokensUsed: 12,
          tokenUsage: {
            inputTokens: 4,
            outputTokens: 8,
            totalTokens: 12,
          },
          model: 'CPA.gpt-5.2',
          finishReason: 'stop' as const,
        };
      }),
      estimateCost: jest.fn(() => 0.0012),
    };

    const messages = [] as Array<{ role: 'user' | 'assistant'; content: string }>;
    const chunks: string[] = [];
    const turn = await runModelTestTurn(
      manager,
      'CPA.gpt-5.2',
      messages,
      'hi',
      (chunk) => chunks.push(chunk)
    );

    expect(turn.ok).toBe(true);
    expect(turn.metadata).toBeDefined();
    expect(turn.metadata?.inputTokens).toBe(4);
    expect(turn.metadata?.outputTokens).toBe(8);
    expect(turn.metadata?.totalTokens).toBe(12);
    expect(chunks).toEqual(['hello']);
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  test('runModelTestTurn falls back to non-streaming when streaming fails before first chunk', async () => {
    const { runModelTestTurn } = await import('../../src/cli/commands/models.js');

    const manager = {
      completeWithModel: jest
        .fn()
        .mockRejectedValueOnce(new Error('Bad Gateway'))
        .mockResolvedValueOnce({
          content: 'fallback-ok',
          tokensUsed: 9,
          model: 'CPA.gpt-5.3-codex',
          finishReason: 'stop' as const,
        }),
      estimateCost: jest.fn(() => 0.0009),
    };

    const messages = [] as Array<{ role: 'user' | 'assistant'; content: string }>;
    const chunks: string[] = [];
    const turn = await runModelTestTurn(
      manager,
      'CPA.gpt-5.3-codex',
      messages,
      'hi',
      (chunk) => chunks.push(chunk)
    );

    expect(turn.ok).toBe(true);
    expect(manager.completeWithModel).toHaveBeenCalledTimes(2);
    expect(manager.completeWithModel).toHaveBeenNthCalledWith(
      1,
      'CPA.gpt-5.3-codex',
      expect.any(Array),
      expect.objectContaining({ stream: true })
    );
    expect(manager.completeWithModel).toHaveBeenNthCalledWith(
      2,
      'CPA.gpt-5.3-codex',
      expect.any(Array),
      expect.objectContaining({ stream: false })
    );
    expect(chunks).toEqual(['fallback-ok']);
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'fallback-ok' },
    ]);
  });
});
