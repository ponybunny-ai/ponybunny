import { LocalEmbeddingService } from '../../../src/app/conversation/local-embedding-service.js';

describe('LocalEmbeddingService', () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  });

  it('uses OpenAI-compatible endpoint when provider is openai', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fetcher = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [3, 4] }] }),
      text: async () => '',
    })) as unknown as typeof fetch;

    const service = new LocalEmbeddingService('openai', {
      fetcher,
      baseUrl: 'https://api.openai.com/v1',
    });

    const vector = await service.embed('hello world');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vector.length).toBe(2);
    expect(vector[0]).toBeCloseTo(0.6, 4);
    expect(vector[1]).toBeCloseTo(0.8, 4);
  });

  it('throws when openai key is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    const service = new LocalEmbeddingService('openai', {
      fetcher: jest.fn() as unknown as typeof fetch,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
    });

    await expect(service.embed('hello')).rejects.toThrow('API key');
  });

  it('falls back to local hash embedding for provider none', async () => {
    const service = new LocalEmbeddingService('none');
    const vector = await service.embed('quick brown fox');
    expect(vector.length).toBe(256);
  });
});
