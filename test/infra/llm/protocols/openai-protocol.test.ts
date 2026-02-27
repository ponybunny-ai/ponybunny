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
        input: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        max_output_tokens: 1000,
        temperature: 0.5,
      });
    });

    it('should use default values for optional config', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = adapter.formatRequest(messages, {
        model: 'gpt-4o',
      }) as Record<string, unknown>;

      expect(result.max_output_tokens).toBe(4000);
      expect(result.temperature).toBe(0.7);
    });

    it('should use max_output_tokens for gpt-5 models', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = adapter.formatRequest(messages, {
        model: 'gpt-5.2',
        maxTokens: 1200,
      }) as Record<string, unknown>;

      expect(result.max_output_tokens).toBe(1200);
    });

    it('should format request for responses API', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = adapter.formatRequest(messages, {
        model: 'gpt-5.2',
        maxTokens: 900,
        openaiOperation: 'responses',
      }) as Record<string, unknown>;

      expect(result.model).toBe('gpt-5.2');
      expect(result.max_output_tokens).toBe(900);
      expect(Array.isArray(result.input)).toBe(true);
    });

    it('should omit temperature for gpt-5 family requests', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano']) {
        const result = adapter.formatRequest(messages, {
          model,
          maxTokens: 900,
          openaiOperation: 'responses',
        }) as Record<string, unknown>;

        expect(result.temperature).toBeUndefined();
        expect(result.max_output_tokens).toBe(900);
      }
    });
  });

  describe('parseResponse', () => {
    it('should parse successful response', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          output_text: 'Hello! How can I help?',
          usage: { total_tokens: 50 },
          model: 'gpt-4o-2024-05-13',
          status: 'completed',
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
          output_text: 'Truncated...',
          usage: { total_tokens: 4000 },
          model: 'gpt-4o',
          status: 'incomplete',
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
          output: [],
          usage: { total_tokens: 0 },
          status: 'completed',
        },
      };

      const result = adapter.parseResponse(response, 'gpt-4o');

      expect(result.content).toBe('');
      expect(result.model).toBe('gpt-4o');
    });

    it('should parse responses API payload', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          model: 'gpt-5.2',
          output_text: 'Responses output',
          usage: { total_tokens: 42 },
          status: 'completed',
        },
      };

      const result = adapter.parseResponse(response, 'gpt-5.2', {
        model: 'gpt-5.2',
        openaiOperation: 'responses',
      });

      expect(result.content).toBe('Responses output');
      expect(result.tokensUsed).toBe(42);
      expect(result.finishReason).toBe('stop');
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

      expect(url).toBe('https://api.openai.com/v1/responses');
    });

    it('should build Azure OpenAI URL', () => {
      const url = adapter.buildUrl(
        'https://my-resource.openai.azure.com',
        'gpt-4o-deployment',
        {}
      );

      expect(url).toBe(
        'https://my-resource.openai.azure.com/openai/deployments/gpt-4o-deployment/responses?api-version=2024-02-15-preview'
      );
    });

    it('should build responses API URL for OpenAI', () => {
      const url = adapter.buildUrl(
        'https://api.openai.com/v1',
        'gpt-5.2',
        {},
        { model: 'gpt-5.2', openaiOperation: 'responses' }
      );

      expect(url).toBe('https://api.openai.com/v1/responses');
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

  describe('parseStreamChunk for Responses API events', () => {
    it('parses response.output_text.delta as content chunk', () => {
      const chunk = adapter.parseStreamChunk(
        'data: {"type":"response.output_text.delta","delta":"Hello"}',
        0
      );

      expect(chunk).toEqual({
        content: 'Hello',
        done: false,
      });
    });

    it('parses response.completed as done chunk', () => {
      const chunk = adapter.parseStreamChunk(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":8,"total_tokens":12}}}',
        1
      );

      expect(chunk).toEqual({
        done: true,
        finishReason: 'stop',
        tokensUsed: 12,
      });
    });

    it('derives token usage from input/output when total_tokens is absent', () => {
      const chunk = adapter.parseStreamChunk(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":5}}}',
        2
      );

      expect(chunk).toEqual({
        done: true,
        finishReason: 'stop',
        tokensUsed: 8,
      });
    });
  });
});
