import { UnifiedLLMService } from '../../../src/infra/llm/unified-llm-service.js';
import { NoopLogger } from '../../../src/infra/observability/logger.js';
import { NoopTracer } from '../../../src/infra/observability/noop-tracer.js';
import type { ILogger } from '../../../src/infra/observability/logger.js';
import type { ITracer, ISpan } from '../../../src/infra/observability/tracer.js';
import type { LLMMessage, LLMResponse } from '../../../src/infra/llm/llm-provider.js';
import type { LLMCompletionOptions as ServiceCompletionOptions } from '../../../src/infra/llm/llm-service.interface.js';

// Minimal mock of the provider manager surface used by UnifiedLLMService
function createMockProviderManager() {
  return {
    complete: jest.fn<Promise<LLMResponse>, [string, LLMMessage[], unknown]>(),
    completeWithModel: jest.fn<Promise<LLMResponse>, [string, LLMMessage[], unknown]>(),
    completeWithTier: jest.fn<Promise<LLMResponse>, [string, LLMMessage[], unknown]>(),
    getCircuitBreakerHealth: jest.fn<
      Array<{ endpointId: string; state: string; failureCount: number; openedAt?: number }>,
      []
    >(),
    // Stubs for ILLMProviderManager surface (not exercised by UnifiedLLMService)
    getConfig: jest.fn(),
    reloadConfig: jest.fn(),
    getEnabledEndpoints: jest.fn(),
    isEndpointAvailable: jest.fn(),
    getAvailableModels: jest.fn(),
    getModelEndpoints: jest.fn(),
    getModelForWorkload: jest.fn(),
    getModelForTier: jest.fn(),
    getFallbackChain: jest.fn(),
  };
}

function makeResponse(overrides: Partial<LLMResponse> = {}): LLMResponse {
  return {
    content: 'hello',
    tokensUsed: 42,
    model: 'test-model',
    finishReason: 'stop',
    ...overrides,
  };
}

const testMessages: LLMMessage[] = [{ role: 'user', content: 'test' }];

describe('UnifiedLLMService', () => {
  let pm: ReturnType<typeof createMockProviderManager>;
  let logger: ILogger;
  let tracer: ITracer;
  let service: UnifiedLLMService;

  beforeEach(() => {
    pm = createMockProviderManager();
    logger = new NoopLogger();
    tracer = new NoopTracer();
    service = new UnifiedLLMService(pm as never, logger, tracer);
  });

  // ---- complete() ----

  describe('complete()', () => {
    it('delegates to provider manager with correct workload', async () => {
      const expected = makeResponse();
      pm.complete.mockResolvedValue(expected);

      const result = await service.complete('planning', testMessages);

      expect(pm.complete).toHaveBeenCalledTimes(1);
      expect(pm.complete).toHaveBeenCalledWith('planning', testMessages, undefined);
      expect(result).toBe(expected);
    });

    it('maps ServiceCompletionOptions to ProviderCompletionOptions', async () => {
      pm.complete.mockResolvedValue(makeResponse());

      const opts: ServiceCompletionOptions = {
        timeoutMs: 5000,
        maxTokens: 100,
        temperature: 0.5,
        stream: true,
        thinking: true,
        goalId: 'g-1',
        workItemId: 'wi-1',
        runId: 'r-1',
      };

      await service.complete('execution', testMessages, opts);

      const passedOpts = pm.complete.mock.calls[0][2] as Record<string, unknown>;
      expect(passedOpts.timeout).toBe(5000);
      expect(passedOpts.maxTokens).toBe(100);
      expect(passedOpts.temperature).toBe(0.5);
      expect(passedOpts.stream).toBe(true);
      expect(passedOpts.thinking).toBe(true);
      expect(passedOpts.goalId).toBe('g-1');
      expect(passedOpts.workItemId).toBe('wi-1');
      expect(passedOpts.runId).toBe('r-1');
    });

    it('propagates errors from provider manager', async () => {
      pm.complete.mockRejectedValue(new Error('provider down'));

      await expect(service.complete('planning', testMessages)).rejects.toThrow('provider down');
    });
  });

  // ---- completeWithModel() ----

  describe('completeWithModel()', () => {
    it('delegates to provider manager with correct model', async () => {
      const expected = makeResponse({ model: 'gpt-4' });
      pm.completeWithModel.mockResolvedValue(expected);

      const result = await service.completeWithModel('gpt-4', testMessages);

      expect(pm.completeWithModel).toHaveBeenCalledTimes(1);
      expect(pm.completeWithModel).toHaveBeenCalledWith('gpt-4', testMessages, undefined);
      expect(result).toBe(expected);
    });

    it('propagates errors from provider manager', async () => {
      pm.completeWithModel.mockRejectedValue(new Error('model not found'));

      await expect(service.completeWithModel('bad-model', testMessages)).rejects.toThrow(
        'model not found',
      );
    });
  });

  // ---- getProviderHealth() ----

  describe('getProviderHealth()', () => {
    it('returns circuit breaker status mapped to ProviderHealthSnapshot', () => {
      pm.getCircuitBreakerHealth.mockReturnValue([
        { endpointId: 'ep-1', state: 'closed', failureCount: 0 },
        { endpointId: 'ep-2', state: 'open', failureCount: 5, openedAt: 1000 },
      ]);

      const result = service.getProviderHealth();

      expect(result).toEqual([
        { endpointId: 'ep-1', state: 'closed', failureCount: 0, openedAt: undefined },
        { endpointId: 'ep-2', state: 'open', failureCount: 5, openedAt: 1000 },
      ]);
    });

    it('returns empty array when no circuit breakers exist', () => {
      pm.getCircuitBreakerHealth.mockReturnValue([]);

      expect(service.getProviderHealth()).toEqual([]);
    });
  });

  // ---- Tracing ----

  describe('tracing', () => {
    it('creates and ends a span with ok status on success (complete)', async () => {
      pm.complete.mockResolvedValue(makeResponse());

      const endFn = jest.fn();
      const setAttributesFn = jest.fn();
      const mockSpan: ISpan = {
        setAttributes: setAttributesFn,
        addEvent: jest.fn(),
        end: endFn,
      };

      const mockTracer: ITracer = {
        startSpan: jest.fn().mockReturnValue(mockSpan),
        withSpan: jest.fn(),
      };

      const svc = new UnifiedLLMService(pm as never, logger, mockTracer);
      await svc.complete('planning', testMessages);

      expect(mockTracer.startSpan).toHaveBeenCalledWith('llm.complete', {
        workload: 'planning',
        messageCount: 1,
      });
      expect(setAttributesFn).toHaveBeenCalledWith({
        model: 'test-model',
        tokensUsed: 42,
      });
      expect(endFn).toHaveBeenCalledWith({ status: 'ok' });
    });

    it('creates and ends a span with ok status on success (completeWithModel)', async () => {
      pm.completeWithModel.mockResolvedValue(makeResponse({ model: 'gpt-4' }));

      const endFn = jest.fn();
      const mockSpan: ISpan = {
        setAttributes: jest.fn(),
        addEvent: jest.fn(),
        end: endFn,
      };

      const mockTracer: ITracer = {
        startSpan: jest.fn().mockReturnValue(mockSpan),
        withSpan: jest.fn(),
      };

      const svc = new UnifiedLLMService(pm as never, logger, mockTracer);
      await svc.completeWithModel('gpt-4', testMessages);

      expect(mockTracer.startSpan).toHaveBeenCalledWith('llm.completeWithModel', {
        model: 'gpt-4',
        messageCount: 1,
      });
      expect(endFn).toHaveBeenCalledWith({ status: 'ok' });
    });

    it('ends span with error status on failure', async () => {
      pm.complete.mockRejectedValue(new Error('boom'));

      const endFn = jest.fn();
      const mockSpan: ISpan = {
        setAttributes: jest.fn(),
        addEvent: jest.fn(),
        end: endFn,
      };

      const mockTracer: ITracer = {
        startSpan: jest.fn().mockReturnValue(mockSpan),
        withSpan: jest.fn(),
      };

      const svc = new UnifiedLLMService(pm as never, logger, mockTracer);
      await expect(svc.complete('execution', testMessages)).rejects.toThrow('boom');

      expect(endFn).toHaveBeenCalledWith({ status: 'error' });
    });

    it('ends span with error status on completeWithModel failure', async () => {
      pm.completeWithModel.mockRejectedValue(new Error('timeout'));

      const endFn = jest.fn();
      const mockSpan: ISpan = {
        setAttributes: jest.fn(),
        addEvent: jest.fn(),
        end: endFn,
      };

      const mockTracer: ITracer = {
        startSpan: jest.fn().mockReturnValue(mockSpan),
        withSpan: jest.fn(),
      };

      const svc = new UnifiedLLMService(pm as never, logger, mockTracer);
      await expect(svc.completeWithModel('gpt-4', testMessages)).rejects.toThrow('timeout');

      expect(endFn).toHaveBeenCalledWith({ status: 'error' });
    });
  });

  // ---- Logging ----

  describe('logging', () => {
    it('logs errors via ILogger on complete failure', async () => {
      pm.complete.mockRejectedValue(new Error('rate limited'));

      const errorFn = jest.fn();
      const mockLogger: ILogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
        child: jest.fn().mockReturnThis(),
      };

      const svc = new UnifiedLLMService(pm as never, mockLogger, tracer);
      await expect(svc.complete('planning', testMessages)).rejects.toThrow('rate limited');

      expect(errorFn).toHaveBeenCalledTimes(1);
      expect(errorFn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'llm.complete.failed', workload: 'planning' }),
        expect.stringContaining('rate limited'),
        expect.any(Error),
      );
    });

    it('logs errors via ILogger on completeWithModel failure', async () => {
      pm.completeWithModel.mockRejectedValue(new Error('bad request'));

      const errorFn = jest.fn();
      const mockLogger: ILogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorFn,
        child: jest.fn().mockReturnThis(),
      };

      const svc = new UnifiedLLMService(pm as never, mockLogger, tracer);
      await expect(svc.completeWithModel('unknown', testMessages)).rejects.toThrow('bad request');

      expect(errorFn).toHaveBeenCalledTimes(1);
      expect(errorFn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'llm.completeWithModel.failed', model: 'unknown' }),
        expect.stringContaining('bad request'),
        expect.any(Error),
      );
    });
  });
});
