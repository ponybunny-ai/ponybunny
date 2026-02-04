import {
  UnifiedLLMProvider,
  getUnifiedProvider,
  resetUnifiedProvider,
} from '../../../src/infra/llm/unified-provider.js';
import { resetModelRouter } from '../../../src/infra/llm/routing/model-router.js';
import { LLMProviderError } from '../../../src/infra/llm/llm-provider.js';
import type { LLMMessage } from '../../../src/infra/llm/llm-provider.js';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('UnifiedLLMProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetUnifiedProvider();
    resetModelRouter();
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetUnifiedProvider();
    resetModelRouter();
  });

  describe('complete', () => {
    it('should throw error when model is not specified', async () => {
      const provider = new UnifiedLLMProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      await expect(provider.complete(messages, {})).rejects.toThrow(
        'Model must be specified'
      );
    });

    it('should throw error when no protocol found for model', async () => {
      const provider = new UnifiedLLMProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      await expect(
        provider.complete(messages, { model: 'unknown-model' })
      ).rejects.toThrow('No protocol found for model: unknown-model');
    });

    it('should throw error when no endpoints available', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;

      const provider = new UnifiedLLMProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      await expect(
        provider.complete(messages, { model: 'claude-opus-4-5-20251101' })
      ).rejects.toThrow('No available endpoints for model: claude-opus-4-5-20251101');
    });

    it('should successfully complete request with anthropic', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Hello! How can I help?' }],
          usage: { input_tokens: 10, output_tokens: 20 },
          model: 'claude-opus-4-5-20251101',
          stop_reason: 'end_turn',
        }),
      });

      const provider = new UnifiedLLMProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = await provider.complete(messages, {
        model: 'claude-opus-4-5-20251101',
      });

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.tokensUsed).toBe(30);
      expect(result.finishReason).toBe('stop');

      // Verify fetch was called with correct URL and headers
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-key',
            'anthropic-version': '2023-06-01',
          }),
        })
      );
    });

    it('should successfully complete request with openai', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'Hello! How can I help?' },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 50 },
          model: 'gpt-4o',
        }),
      });

      const provider = new UnifiedLLMProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = await provider.complete(messages, { model: 'gpt-4o' });

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.tokensUsed).toBe(50);

      // Verify fetch was called with correct URL and headers
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test-key',
          }),
        })
      );
    });

    it('should fallback to next endpoint on failure', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.AWS_ACCESS_KEY_ID = 'aws-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';

      // First call fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: { message: 'Server error' } }),
      });

      // Second call succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Success from Bedrock!' }],
          usage: { input_tokens: 10, output_tokens: 20 },
          model: 'claude-opus-4-5-20251101',
          stop_reason: 'end_turn',
        }),
      });

      const provider = new UnifiedLLMProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = await provider.complete(messages, {
        model: 'claude-opus-4-5-20251101',
      });

      expect(result.content).toBe('Success from Bedrock!');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw non-recoverable errors immediately', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.AWS_ACCESS_KEY_ID = 'aws-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'aws-secret';

      // Rate limit error (non-recoverable)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ error: { message: 'Rate limited' } }),
      });

      const provider = new UnifiedLLMProvider();
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      await expect(
        provider.complete(messages, { model: 'claude-opus-4-5-20251101' })
      ).rejects.toThrow(LLMProviderError);

      // Should not try second endpoint for rate limit
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getName', () => {
    it('should return unified-provider', () => {
      const provider = new UnifiedLLMProvider();
      expect(provider.getName()).toBe('unified-provider');
    });
  });

  describe('isAvailable', () => {
    it('should return true when any endpoint is available', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const provider = new UnifiedLLMProvider();

      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return false when no endpoints are available', async () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.GOOGLE_CLOUD_PROJECT;

      const provider = new UnifiedLLMProvider();

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('getUnifiedProvider singleton', () => {
    it('should return same instance', () => {
      const provider1 = getUnifiedProvider();
      const provider2 = getUnifiedProvider();

      expect(provider1).toBe(provider2);
    });

    it('should reset singleton', () => {
      const provider1 = getUnifiedProvider();
      resetUnifiedProvider();
      const provider2 = getUnifiedProvider();

      expect(provider1).not.toBe(provider2);
    });
  });
});
