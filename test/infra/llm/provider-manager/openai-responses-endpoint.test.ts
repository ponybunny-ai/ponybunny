import {
  getLLMProviderManager,
  resetLLMProviderManager,
  getCachedConfig,
  clearConfigCache,
  resetEndpointManager,
  resetWorkloadModelResolver,
} from '../../../../src/infra/llm/provider-manager/index.js';

jest.mock('../../../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));

describe('LLMProviderManager OpenAI protocol endpoint normalization', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_COMPATIBLE_API_KEY = 'test-openai-compatible-key';

    resetLLMProviderManager();
    resetEndpointManager();
    resetWorkloadModelResolver();
    clearConfigCache();

    global.fetch = jest.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: 'ok',
          usage: { total_tokens: 12 },
          model: 'custom-openai-endpoint.gpt-5.2-custom',
          status: 'completed',
        }),
        {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' },
        }
      )
    ) as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;

    resetLLMProviderManager();
    resetEndpointManager();
    resetWorkloadModelResolver();
    clearConfigCache();
  });

  it('uses /v1/responses for custom OpenAI-compatible providers when model endpoints are omitted', async () => {
    const config = getCachedConfig();

    config.providers['custom-openai-endpoint'] = {
      enabled: true,
      protocol: 'openai',
      baseUrl: 'https://proxy.example.com',
      priority: 1,
      requiredEnvVars: ['OPENAI_COMPATIBLE_API_KEY'],
    };

    config.models['custom-openai-endpoint.gpt-5.2-custom'] = {
      displayName: 'Custom OpenAI-Compatible GPT',
      providers: ['custom-openai-endpoint'],
      costPer1kTokens: { input: 0.001, output: 0.002 },
    };

    const manager = getLLMProviderManager();
    await manager.completeWithModel('custom-openai-endpoint.gpt-5.2-custom', [
      { role: 'user', content: 'ping' },
    ]);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://proxy.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      })
    );

    const customCalls = (global.fetch as jest.Mock).mock.calls;
    const [, customCallInit] = customCalls[customCalls.length - 1] as [string, RequestInit];
    const customPayload = JSON.parse(String(customCallInit.body));
    expect(customPayload.model).toBe('gpt-5.2-custom');
    expect(customPayload.temperature).toBeUndefined();
  });

  it('uses /v1/responses for official OpenAI providers when model endpoints are omitted', async () => {
    const config = getCachedConfig();

    config.models['openai.gpt-5.2-no-endpoints'] = {
      displayName: 'OpenAI GPT no endpoints',
      providers: ['openai'],
      costPer1kTokens: { input: 0.001, output: 0.002 },
    };

    process.env.OPENAI_API_KEY = 'test-openai-key';

    const manager = getLLMProviderManager();
    await manager.completeWithModel('openai.gpt-5.2-no-endpoints', [
      { role: 'user', content: 'ping' },
    ]);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      })
    );

    const openaiCalls = (global.fetch as jest.Mock).mock.calls;
    const [, openaiCallInit] = openaiCalls[openaiCalls.length - 1] as [string, RequestInit];
    const openaiPayload = JSON.parse(String(openaiCallInit.body));
    expect(openaiPayload.model).toBe('gpt-5.2-no-endpoints');
    expect(openaiPayload.temperature).toBeUndefined();
  });
});
