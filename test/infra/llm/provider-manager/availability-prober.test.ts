import { probeAndPersistAvailability } from '../../../../src/infra/llm/provider-manager/availability-prober.js';

const mockLoadLLMConfig = jest.fn();
const mockSaveLLMConfig = jest.fn();
const mockClearConfigCache = jest.fn();
const mockGetEndpointManager = jest.fn();
const mockGetProtocolAdapter = jest.fn();

jest.mock('../../../../src/infra/llm/provider-manager/config-loader.js', () => ({
  loadLLMConfig: (...args: unknown[]) => mockLoadLLMConfig(...args),
  saveLLMConfig: (...args: unknown[]) => mockSaveLLMConfig(...args),
  clearConfigCache: () => mockClearConfigCache(),
}));

jest.mock('../../../../src/infra/llm/provider-manager/endpoint-manager.js', () => ({
  getEndpointManager: () => mockGetEndpointManager(),
}));

jest.mock('../../../../src/infra/llm/protocols/index.js', () => ({
  getProtocolAdapter: (...args: unknown[]) => mockGetProtocolAdapter(...args),
}));

describe('probeAndPersistAvailability', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();

    mockGetEndpointManager.mockReturnValue({
      resolveCredentials: jest.fn(() => ({ apiKey: 'k' })),
      hasCredentials: jest.fn(() => true),
      clearHealthCache: jest.fn(),
    });

    mockGetProtocolAdapter.mockReturnValue({
      formatRequest: jest.fn(() => ({ messages: [] })),
      buildUrl: jest.fn((baseUrl: string) => `${baseUrl}/responses`),
      buildHeaders: jest.fn(() => ({ Authorization: 'Bearer k' })),
      extractErrorMessage: jest.fn((data: Record<string, unknown>) => String(data.error || 'bad request')),
      parseResponse: jest.fn(() => ({ content: 'pong' })),
    });

    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ id: 'resp-1' }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      })
    ) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('persists endpoint and model health after successful probe', async () => {
    mockLoadLLMConfig.mockReturnValue({
      providers: {
        'openai-direct': {
          enabled: true,
          protocol: 'openai',
          priority: 1,
          baseUrl: 'https://api.openai.com/v1',
        },
      },
      models: {
        'gpt-5.2': {
          displayName: 'GPT-5.2',
          providers: ['openai-direct'],
          costPer1kTokens: { input: 0.01, output: 0.03 },
        },
      },
      tiers: {
        simple: { primary: 'gpt-5.2' },
        medium: { primary: 'gpt-5.2' },
        complex: { primary: 'gpt-5.2' },
      },
      workloads: {
        execution: { tier: 'medium' },
      },
      defaults: { timeout: 120000, maxTokens: 4096 },
    });

    const summary = await probeAndPersistAvailability({ timeoutMs: 5000, maxModelsPerEndpoint: 5 });

    expect(summary.endpointCount).toBe(1);
    expect(summary.modelEndpointChecks).toBe(1);
    expect(summary.endpointAvailable).toBe(1);
    expect(summary.modelEndpointAvailable).toBe(1);

    expect(mockSaveLLMConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveLLMConfig.mock.calls[0][0];

    expect(savedConfig.providers['openai-direct'].health.available).toBe(true);
    expect(savedConfig.providers['openai-direct'].health.successfulModels).toEqual(['gpt-5.2']);
    expect(savedConfig.models['gpt-5.2'].health.providers['openai-direct'].available).toBe(true);
    expect(mockClearConfigCache).toHaveBeenCalledTimes(1);
  });

  it('records probe failures and persists unavailable health status', async () => {
    mockLoadLLMConfig.mockReturnValue({
      providers: {
        'openai-compatible': {
          enabled: true,
          protocol: 'openai',
          priority: 1,
          baseUrl: 'https://forwarder.example/v1',
        },
      },
      models: {
        'gpt-5.2': {
          displayName: 'GPT-5.2',
          providers: ['openai-compatible'],
          costPer1kTokens: { input: 0.01, output: 0.03 },
        },
      },
      tiers: {
        simple: { primary: 'gpt-5.2' },
        medium: { primary: 'gpt-5.2' },
        complex: { primary: 'gpt-5.2' },
      },
      workloads: {
        execution: { tier: 'medium' },
      },
      defaults: { timeout: 120000, maxTokens: 4096 },
    });

    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: 'Bad Gateway' }), {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'application/json' },
      })
    ) as typeof fetch;

    const summary = await probeAndPersistAvailability({ timeoutMs: 5000, maxModelsPerEndpoint: 5 });

    expect(summary.endpointAvailable).toBe(0);
    expect(summary.modelEndpointAvailable).toBe(0);
    expect(summary.failures.length).toBe(1);
    expect(summary.failures[0].endpointId).toBe('openai-compatible');
    expect(summary.failures[0].modelId).toBe('gpt-5.2');

    const savedConfig = mockSaveLLMConfig.mock.calls[0][0];
    expect(savedConfig.providers['openai-compatible'].health.available).toBe(false);
    expect(savedConfig.models['gpt-5.2'].health.providers['openai-compatible'].available).toBe(false);
  });
});
