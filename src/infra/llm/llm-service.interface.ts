/**
 * Unified LLM Service Interface — the single entry point for all LLM operations.
 *
 * Replaces the dual-entry (LLMProviderManager + LLMService) pattern with
 * a single interface that handles workload-based selection, fallback,
 * retry, and circuit breaking internally.
 *
 * Consumers should depend on ILLMService rather than LLMProviderManager
 * or the old LLMService class.
 */

import type { LLMMessage, LLMResponse, ToolDefinition } from './llm-provider.js';
import type { CircuitState } from './circuit-breaker.js';

export type LLMWorkload =
  | 'execution'
  | 'planning'
  | 'elaboration'
  | 'evaluation'
  | 'conversation'
  | 'quality-review'
  | 'input-analysis'
  | 'response-generation'
  | 'verification';

export interface ILLMService {
  /**
   * Primary entry point: complete using workload-based model selection.
   * Internally handles fallback chains, retry, and circuit breaking.
   */
  complete(
    workload: LLMWorkload | string,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse>;

  /**
   * Explicit model override (used by switch_model retry strategy).
   */
  completeWithModel(
    model: string,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse>;

  /**
   * Query current endpoint health (for debug.snapshot and dashboards).
   */
  getProviderHealth(): ProviderHealthSnapshot[];
}

export interface LLMCompletionOptions {
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
  abortSignal?: AbortSignal;
  thinking?: boolean;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  /** Streaming callbacks */
  onChunk?: (chunk: string, index: number) => void;
  onComplete?: (response: LLMResponse) => void;
  onError?: (error: Error) => void;
}

export interface ProviderHealthSnapshot {
  endpointId: string;
  state: CircuitState;
  failureCount: number;
  openedAt?: number;
}
