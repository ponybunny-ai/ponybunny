import {
  OpenAIProtocolAdapter,
  getOpenAIProtocol,
} from '../../../../src/infra/llm/protocols/openai-protocol.js';
import type { LLMMessage } from '../../../../src/infra/llm/llm-provider.js';

describe('OpenAIProtocolAdapter', () => {
  let adapter: OpenAIProtocolAdapter;

  beforeEach(() => {
    adapter = new OpenAIProtocolAdapter();
  });

  describe('protocolId', () => {
    it('should return openai', () => {
      expect(adapter.protocolId).toBe('openai');
    });
  });

  describe('formatRequest', () => {
    it('should format messages correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];

      const result = adapter.formatRequest(messages, {
        model: 'gpt-4o',
        maxTokens: 1000,
        temperature: 0.5,
      });

      expect(result).toEqual({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        max_tokens: 1000,
        temperature: 0.5,
      });
    });

    it('should use default values for optional config', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = adapter.formatRequest(messages, {
        model: 'gpt-4o',
      }) as Record<string, unknown>;

      expect(result.max_tokens).toBe(4000);
      expect(result.temperature).toBe(0.7);
    });
  });

  describe('parseResponse', () => {
    it('should parse successful response', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          choices: [
            {
              message: { content: 'Hello! How can I help?' },
              finish_reason: 'stop',
            },
          ],
          usage: { total_tokens: 50 },
          model: 'gpt-4o-2024-05-13',
        },
      };

      const result = adapter.parseResponse(response, 'gpt-4o');

      expect(result).toEqual({
        content: 'Hello! How can I help?',
        tokensUsed: 50,
        model: 'gpt-4o-2024-05-13',
        finishReason: 'stop',
      });
    });

    it('should handle length finish reason', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          choices: [
            {
              message: { content: 'Truncated...' },
              finish_reason: 'length',
            },
          ],
          usage: { total_tokens: 4000 },
          model: 'gpt-4o',
        },
      };

      const result = adapter.parseResponse(response, 'gpt-4o');

      expect(result.finishReason).toBe('length');
    });

    it('should handle empty choices', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          choices: [],
          usage: { total_tokens: 0 },
        },
      };

      const result = adapter.parseResponse(response, 'gpt-4o');

      expect(result.content).toBe('');
      expect(result.model).toBe('gpt-4o');
    });
  });

  describe('buildHeaders', () => {
    it('should build headers with Bearer token', () => {
      const headers = adapter.buildHeaders({ apiKey: 'sk-test-key' });

      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-test-key',
      });
    });
  });

  describe('buildUrl', () => {
    it('should build standard OpenAI URL', () => {
      const url = adapter.buildUrl('https://api.openai.com/v1', 'gpt-4o', {});

      expect(url).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('should build Azure OpenAI URL', () => {
      const url = adapter.buildUrl(
        'https://my-resource.openai.azure.com',
        'gpt-4o-deployment',
        {}
      );

      expect(url).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/gpt-4o-deployment/chat/completions?api-version=2024-02-15-preview'
      );
    });
  });

  describe('buildAzureHeaders', () => {
    it('should build Azure-specific headers', () => {
      const headers = adapter.buildAzureHeaders({ apiKey: 'azure-key' });

      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'api-key': 'azure-key',
      });
    });
  });

  describe('isRecoverableError', () => {
    it('should return false for rate limit (429)', () => {
      expect(adapter.isRecoverableError(429)).toBe(false);
    });

    it('should return true for other errors', () => {
      expect(adapter.isRecoverableError(500)).toBe(true);
      expect(adapter.isRecoverableError(400)).toBe(true);
    });
  });

  describe('getOpenAIProtocol', () => {
    it('should return singleton instance', () => {
      const instance1 = getOpenAIProtocol();
      const instance2 = getOpenAIProtocol();

      expect(instance1).toBe(instance2);
    });
  });
});
