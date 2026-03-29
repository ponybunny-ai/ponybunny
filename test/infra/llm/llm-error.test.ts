import { classifyHttpStatus, classifyNetworkError, LLM_ERROR_DEFAULTS } from '../../../src/infra/llm/llm-error.js';
import { LLMProviderError } from '../../../src/infra/llm/llm-provider.js';

describe('LLM Error Types', () => {
  describe('classifyHttpStatus', () => {
    it('classifies 429 as rate_limited', () => {
      expect(classifyHttpStatus(429)).toBe('rate_limited');
    });

    it('classifies 401 and 403 as auth_failed', () => {
      expect(classifyHttpStatus(401)).toBe('auth_failed');
      expect(classifyHttpStatus(403)).toBe('auth_failed');
    });

    it('classifies 404 as model_unavailable', () => {
      expect(classifyHttpStatus(404)).toBe('model_unavailable');
    });

    it('classifies 5xx as server_error', () => {
      expect(classifyHttpStatus(500)).toBe('server_error');
      expect(classifyHttpStatus(502)).toBe('server_error');
      expect(classifyHttpStatus(503)).toBe('server_error');
    });

    it('classifies other statuses as unknown', () => {
      expect(classifyHttpStatus(400)).toBe('unknown');
      expect(classifyHttpStatus(422)).toBe('unknown');
    });
  });

  describe('classifyNetworkError', () => {
    it('classifies ECONNRESET as network_error', () => {
      expect(classifyNetworkError(new Error('connect ECONNRESET'))).toBe('network_error');
    });

    it('classifies ETIMEDOUT as timeout', () => {
      expect(classifyNetworkError(new Error('connect ETIMEDOUT'))).toBe('timeout');
    });

    it('classifies timeout as timeout', () => {
      expect(classifyNetworkError(new Error('Request timeout'))).toBe('timeout');
    });

    it('classifies aborted as timeout', () => {
      expect(classifyNetworkError(new Error('The operation was aborted'))).toBe('timeout');
    });

    it('classifies unknown errors as unknown', () => {
      expect(classifyNetworkError(new Error('Something weird happened'))).toBe('unknown');
    });
  });

  describe('LLM_ERROR_DEFAULTS', () => {
    it('marks rate_limited as recoverable with same_model strategy', () => {
      expect(LLM_ERROR_DEFAULTS.rate_limited).toEqual({
        recoverable: true,
        strategy: 'same_model',
      });
    });

    it('marks auth_failed as non-recoverable with escalate strategy', () => {
      expect(LLM_ERROR_DEFAULTS.auth_failed).toEqual({
        recoverable: false,
        strategy: 'escalate',
      });
    });

    it('marks context_exceeded as recoverable with switch_model strategy', () => {
      expect(LLM_ERROR_DEFAULTS.context_exceeded).toEqual({
        recoverable: true,
        strategy: 'switch_model',
      });
    });

    it('covers all LLMErrorCode values', () => {
      const allCodes = [
        'rate_limited', 'context_exceeded', 'auth_failed', 'content_policy',
        'quota_exceeded', 'server_error', 'timeout', 'network_error',
        'model_unavailable', 'unknown',
      ] as const;
      for (const code of allCodes) {
        expect(LLM_ERROR_DEFAULTS[code]).toBeDefined();
      }
    });
  });

  describe('LLMProviderError (enhanced)', () => {
    it('includes errorCode and retryAfterMs when provided', () => {
      const error = new LLMProviderError(
        'Rate limited',
        'anthropic',
        true,
        { errorCode: 'rate_limited', retryAfterMs: 5000 }
      );

      expect(error.errorCode).toBe('rate_limited');
      expect(error.retryAfterMs).toBe(5000);
      expect(error.provider).toBe('anthropic');
      expect(error.recoverable).toBe(true);
      expect(error.message).toBe('Rate limited');
    });

    it('defaults errorCode to unknown when not provided', () => {
      const error = new LLMProviderError('Some error', 'openai', false);
      expect(error.errorCode).toBe('unknown');
      expect(error.retryAfterMs).toBeUndefined();
    });

    it('preserves backward compatibility with 3-arg constructor', () => {
      const error = new LLMProviderError('Old-style error', 'anthropic', true);
      expect(error.name).toBe('LLMProviderError');
      expect(error.provider).toBe('anthropic');
      expect(error.recoverable).toBe(true);
      expect(error.errorCode).toBe('unknown');
    });

    it('stores cause when provided', () => {
      const cause = new Error('original');
      const error = new LLMProviderError('Wrapped', 'test', true, { cause });
      expect(error.cause).toBe(cause);
    });
  });
});
