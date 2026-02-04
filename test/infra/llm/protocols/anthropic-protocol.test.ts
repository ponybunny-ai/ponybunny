import {
  AnthropicProtocolAdapter,
  getAnthropicProtocol,
} from '../../../../src/infra/llm/protocols/anthropic-protocol.js';
import type { LLMMessage } from '../../../../src/infra/llm/llm-provider.js';

describe('AnthropicProtocolAdapter', () => {
  let adapter: AnthropicProtocolAdapter;

  beforeEach(() => {
    adapter = new AnthropicProtocolAdapter();
  });

  describe('protocolId', () => {
    it('should return anthropic', () => {
      expect(adapter.protocolId).toBe('anthropic');
    });
  });

  describe('formatRequest', () => {
    it('should format messages correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = adapter.formatRequest(messages, {
        model: 'claude-opus-4-5-20251101',
        maxTokens: 1000,
        temperature: 0.5,
      });

      expect(result).toEqual({
        model: 'claude-opus-4-5-20251101',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
        system: undefined,
        max_tokens: 1000,
        temperature: 0.5,
      });
    });

    it('should extract system message separately', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = adapter.formatRequest(messages, {
        model: 'claude-opus-4-5-20251101',
      }) as Record<string, unknown>;

      expect(result.system).toBe('You are a helpful assistant.');
      expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('should use default values for optional config', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = adapter.formatRequest(messages, {
        model: 'claude-opus-4-5-20251101',
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
          content: [{ type: 'text', text: 'Hello! How can I help you?' }],
          usage: { input_tokens: 10, output_tokens: 20 },
          model: 'claude-opus-4-5-20251101',
          stop_reason: 'end_turn',
        },
      };

      const result = adapter.parseResponse(response, 'claude-opus-4-5-20251101');

      expect(result).toEqual({
        content: 'Hello! How can I help you?',
        tokensUsed: 30,
        model: 'claude-opus-4-5-20251101',
        finishReason: 'stop',
      });
    });

    it('should handle max_tokens finish reason', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          content: [{ type: 'text', text: 'Truncated...' }],
          usage: { input_tokens: 10, output_tokens: 4000 },
          model: 'claude-opus-4-5-20251101',
          stop_reason: 'max_tokens',
        },
      };

      const result = adapter.parseResponse(response, 'claude-opus-4-5-20251101');

      expect(result.finishReason).toBe('length');
    });

    it('should handle empty content', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          content: [],
          usage: { input_tokens: 10, output_tokens: 0 },
          model: 'claude-opus-4-5-20251101',
        },
      };

      const result = adapter.parseResponse(response, 'claude-opus-4-5-20251101');

      expect(result.content).toBe('');
    });
  });

  describe('buildHeaders', () => {
    it('should build headers with API key', () => {
      const headers = adapter.buildHeaders({ apiKey: 'test-key' });

      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-key',
      });
    });

    it('should build headers without API key', () => {
      const headers = adapter.buildHeaders({});

      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      });
    });
  });

  describe('isRecoverableError', () => {
    it('should return false for rate limit (429)', () => {
      expect(adapter.isRecoverableError(429)).toBe(false);
    });

    it('should return true for server errors', () => {
      expect(adapter.isRecoverableError(500)).toBe(true);
      expect(adapter.isRecoverableError(502)).toBe(true);
      expect(adapter.isRecoverableError(503)).toBe(true);
    });

    it('should return true for client errors (except 429)', () => {
      expect(adapter.isRecoverableError(400)).toBe(true);
      expect(adapter.isRecoverableError(401)).toBe(true);
    });
  });

  describe('getAnthropicProtocol', () => {
    it('should return singleton instance', () => {
      const instance1 = getAnthropicProtocol();
      const instance2 = getAnthropicProtocol();

      expect(instance1).toBe(instance2);
    });
  });
});
