import {
  buildOpenAIModelsEndpoint,
  fetchOpenAIProtocolModels,
  testOpenAIProtocolConnection,
} from '../../../../src/infra/llm/provider-manager/openai-model-catalog.js';

describe('openai-model-catalog', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('builds models endpoint from base url ending with /v1', () => {
    expect(buildOpenAIModelsEndpoint('https://example.com/v1')).toBe('https://example.com/v1/models');
  });

  it('builds models endpoint from base url without /v1', () => {
    expect(buildOpenAIModelsEndpoint('https://example.com')).toBe('https://example.com/v1/models');
  });

  it('tests connectivity successfully when models endpoint returns ok', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

    await expect(testOpenAIProtocolConnection('https://example.com', 'key')).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer key' },
      })
    );
  });

  it('throws connectivity error when endpoint fails', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Unauthorized',
    }) as unknown as typeof fetch;

    await expect(testOpenAIProtocolConnection('https://example.com', 'key'))
      .rejects.toThrow('HTTP 401: Unauthorized');
  });

  it('collects model ids from data and models arrays', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-5.2' }, { id: 'gpt-5.2' }],
        models: ['gpt-5-mini', { id: 'gpt-5.1' }],
      }),
    }) as unknown as typeof fetch;

    await expect(fetchOpenAIProtocolModels('https://example.com', 'key'))
      .resolves.toEqual(['gpt-5-mini', 'gpt-5.1', 'gpt-5.2']);
  });
});
