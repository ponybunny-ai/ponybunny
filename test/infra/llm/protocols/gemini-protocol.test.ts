import {
  GeminiProtocolAdapter,
  getGeminiProtocol,
} from '../../../../src/infra/llm/protocols/gemini-protocol.js';
import type { LLMMessage } from '../../../../src/infra/llm/llm-provider.js';

describe('GeminiProtocolAdapter', () => {
  let adapter: GeminiProtocolAdapter;

  beforeEach(() => {
    adapter = new GeminiProtocolAdapter();
  });

  describe('protocolId', () => {
    it('should return gemini', () => {
      expect(adapter.protocolId).toBe('gemini');
    });
  });

  describe('formatRequest', () => {
    it('should format messages correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ];

      const result = adapter.formatRequest(messages, {
        model: 'gemini-2.0-flash',
        maxTokens: 1000,
        temperature: 0.5,
      }) as Record<string, unknown>;

      expect(result.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi!' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ]);
      expect(result.generationConfig).toEqual({
        maxOutputTokens: 1000,
        temperature: 0.5,
      });
    });

    it('should extract system instruction separately', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = adapter.formatRequest(messages, {
        model: 'gemini-2.0-flash',
      }) as Record<string, unknown>;

      expect(result.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant.' }],
      });
      expect(result.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
      ]);
    });

    it('should use default values for optional config', () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'Hello' }];

      const result = adapter.formatRequest(messages, {
        model: 'gemini-2.0-flash',
      }) as Record<string, unknown>;

      const genConfig = result.generationConfig as Record<string, unknown>;
      expect(genConfig.maxOutputTokens).toBe(4000);
      expect(genConfig.temperature).toBe(0.7);
    });
  });

  describe('parseResponse', () => {
    it('should parse successful response', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Hello! How can I help you?' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
          },
        },
      };

      const result = adapter.parseResponse(response, 'gemini-2.0-flash');

      expect(result).toEqual({
        content: 'Hello! How can I help you?',
        tokensUsed: 30,
        model: 'gemini-2.0-flash',
        finishReason: 'stop',
      });
    });

    it('should handle MAX_TOKENS finish reason', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          candidates: [
            {
              content: { parts: [{ text: 'Truncated...' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4000 },
        },
      };

      const result = adapter.parseResponse(response, 'gemini-2.0-flash');

      expect(result.finishReason).toBe('length');
    });

    it('should handle SAFETY finish reason', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          candidates: [
            {
              content: { parts: [] },
              finishReason: 'SAFETY',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0 },
        },
      };

      const result = adapter.parseResponse(response, 'gemini-2.0-flash');

      expect(result.finishReason).toBe('error');
    });

    it('should concatenate multiple text parts', () => {
      const response = {
        status: 200,
        statusText: 'OK',
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Part 1. ' }, { text: 'Part 2.' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        },
      };

      const result = adapter.parseResponse(response, 'gemini-2.0-flash');

      expect(result.content).toBe('Part 1. Part 2.');
    });
  });

  describe('buildHeaders', () => {
    it('should build headers without auth (API key in URL)', () => {
      const headers = adapter.buildHeaders({ apiKey: 'test-key' });

      expect(headers).toEqual({
        'Content-Type': 'application/json',
      });
    });
  });

  describe('buildUrl', () => {
    it('should build Google AI Studio URL', () => {
      const url = adapter.buildUrl(
        'https://generativelanguage.googleapis.com/v1beta',
        'gemini-2.0-flash',
        { apiKey: 'test-key' }
      );

      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test-key'
      );
    });

    it('should build Vertex AI URL', () => {
      const url = adapter.buildUrl(
        'https://us-central1-aiplatform.googleapis.com/v1',
        'gemini-2.0-flash',
        { projectId: 'my-project', region: 'us-central1' }
      );

      expect(url).toBe(
        'https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-2.0-flash:generateContent'
      );
    });
  });

  describe('isRecoverableError', () => {
    it('should return false for rate limit (429)', () => {
      expect(adapter.isRecoverableError(429)).toBe(false);
    });

    it('should return false for blocked content', () => {
      const response = {
        promptFeedback: { blockReason: 'SAFETY' },
      };
      expect(adapter.isRecoverableError(200, response)).toBe(false);
    });

    it('should return true for other errors', () => {
      expect(adapter.isRecoverableError(500)).toBe(true);
    });
  });

  describe('extractErrorMessage', () => {
    it('should extract block reason', () => {
      const response = {
        promptFeedback: { blockReason: 'SAFETY' },
      };

      const message = adapter.extractErrorMessage(response);

      expect(message).toBe('Content blocked: SAFETY');
    });
  });

  describe('getGeminiProtocol', () => {
    it('should return singleton instance', () => {
      const instance1 = getGeminiProtocol();
      const instance2 = getGeminiProtocol();

      expect(instance1).toBe(instance2);
    });
  });
});
