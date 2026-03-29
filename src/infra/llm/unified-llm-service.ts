/**
 * UnifiedLLMService - Adapter implementing ILLMService over ILLMProviderManager.
 *
 * This is a thin adapter layer (ADR-002 Phase B2) that:
 *   - Maps ILLMService types to ILLMProviderManager types
 *   - Adds ITracer spans around completion calls
 *   - Logs warnings/errors via ILogger (not console)
 *   - Delegates getProviderHealth() to circuit breaker health
 *
 * All constructor dependencies are injected (no global singletons).
 */

import type {
  ILLMService,
  LLMWorkload,
  LLMCompletionOptions as ServiceCompletionOptions,
  ProviderHealthSnapshot,
} from './llm-service.interface.js';
import type { LLMMessage, LLMResponse } from './llm-provider.js';
import type { ILLMProviderManager, LLMCompletionOptions as ProviderCompletionOptions } from './provider-manager/types.js';
import type { ILogger } from '../observability/logger.js';
import type { ITracer } from '../observability/tracer.js';
import type { LLMProviderManager } from './provider-manager/provider-manager.js';
import type { CircuitState } from './circuit-breaker.js';

/**
 * Extended provider manager interface that includes getCircuitBreakerHealth().
 *
 * ILLMProviderManager (from types.ts) does not declare getCircuitBreakerHealth,
 * but the concrete LLMProviderManager class does. We use a narrow intersection
 * so the adapter only requires what it actually calls.
 */
type ProviderManagerWithHealth = ILLMProviderManager & {
  getCircuitBreakerHealth(): Array<{
    endpointId: string;
    state: string;
    failureCount: number;
    openedAt?: number;
  }>;
};

export class UnifiedLLMService implements ILLMService {
  private readonly provider: ProviderManagerWithHealth;
  private readonly logger: ILogger;
  private readonly tracer: ITracer;

  constructor(
    providerManager: LLMProviderManager | ProviderManagerWithHealth,
    logger: ILogger,
    tracer: ITracer,
  ) {
    this.provider = providerManager as ProviderManagerWithHealth;
    this.logger = logger;
    this.tracer = tracer;
  }

  async complete(
    workload: LLMWorkload | string,
    messages: LLMMessage[],
    options?: ServiceCompletionOptions,
  ): Promise<LLMResponse> {
    const span = this.tracer.startSpan('llm.complete', {
      workload,
      messageCount: messages.length,
    });

    try {
      const providerOptions = this.mapOptions(options);
      const response = await this.provider.complete(workload, messages, providerOptions);

      span.setAttributes({
        model: response.model ?? '',
        tokensUsed: response.tokensUsed ?? 0,
      });
      span.end({ status: 'ok' });

      return response;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        { event: 'llm.complete.failed', workload: String(workload) },
        `LLM completion failed for workload "${workload}": ${err.message}`,
        err,
      );
      span.end({ status: 'error' });
      throw error;
    }
  }

  async completeWithModel(
    model: string,
    messages: LLMMessage[],
    options?: ServiceCompletionOptions,
  ): Promise<LLMResponse> {
    const span = this.tracer.startSpan('llm.completeWithModel', {
      model,
      messageCount: messages.length,
    });

    try {
      const providerOptions = this.mapOptions(options);
      const response = await this.provider.completeWithModel(model, messages, providerOptions);

      span.setAttributes({
        model: response.model ?? model,
        tokensUsed: response.tokensUsed ?? 0,
      });
      span.end({ status: 'ok' });

      return response;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        { event: 'llm.completeWithModel.failed', model },
        `LLM completion failed for model "${model}": ${err.message}`,
        err,
      );
      span.end({ status: 'error' });
      throw error;
    }
  }

  getProviderHealth(): ProviderHealthSnapshot[] {
    const health = this.provider.getCircuitBreakerHealth();
    return health.map((entry) => ({
      endpointId: entry.endpointId,
      state: entry.state as CircuitState,
      failureCount: entry.failureCount,
      openedAt: entry.openedAt,
    }));
  }

  /**
   * Map ILLMService completion options to ILLMProviderManager completion options.
   * The types are largely compatible; this method bridges any differences.
   */
  private mapOptions(options?: ServiceCompletionOptions): ProviderCompletionOptions | undefined {
    if (!options) return undefined;

    const mapped: ProviderCompletionOptions = {};

    if (options.timeoutMs !== undefined) mapped.timeout = options.timeoutMs;
    if (options.maxTokens !== undefined) mapped.maxTokens = options.maxTokens;
    if (options.temperature !== undefined) mapped.temperature = options.temperature;
    if (options.tools !== undefined) mapped.tools = options.tools;
    if (options.stream !== undefined) mapped.stream = options.stream;
    if (options.thinking !== undefined) mapped.thinking = options.thinking;
    if (options.goalId !== undefined) mapped.goalId = options.goalId;
    if (options.workItemId !== undefined) mapped.workItemId = options.workItemId;
    if (options.runId !== undefined) mapped.runId = options.runId;
    if (options.onChunk !== undefined) mapped.onChunk = options.onChunk;
    if (options.onComplete !== undefined) mapped.onComplete = options.onComplete;
    if (options.onError !== undefined) mapped.onError = options.onError;

    return mapped;
  }
}
