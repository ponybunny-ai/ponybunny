/**
 * Convenient debug API for instrumentation.
 * Provides typed methods for emitting common debug events.
 */

import { debugEmitter } from './emitter.js';
import type { DebugContext } from './types.js';

/**
 * Debug API object with convenience methods for common event types.
 */
export const debug = {
  // ========== State Management ==========

  /**
   * Check if debug mode is enabled.
   */
  get enabled(): boolean {
    return debugEmitter.isEnabled();
  },

  /**
   * Set the current context for event correlation.
   */
  setContext(ctx: DebugContext): void {
    debugEmitter.setContext(ctx);
  },

  /**
   * Get the current context.
   */
  getContext(): DebugContext {
    return debugEmitter.getContext();
  },

  /**
   * Clear the current context.
   */
  clearContext(): void {
    debugEmitter.clearContext();
  },

  // ========== Goal Events ==========

  /**
   * Emit goal.created event.
   */
  goalCreated(goal: { id: string; title?: string; [key: string]: unknown }): void {
    debugEmitter.emitDebug('goal.created', 'scheduler', { goal });
  },

  /**
   * Emit goal.status_changed event.
   */
  goalStatusChanged(goalId: string, from: string, to: string): void {
    debugEmitter.emitDebug('goal.status_changed', 'scheduler', { goalId, from, to });
  },

  /**
   * Emit goal.completed event.
   */
  goalCompleted(goalId: string, result?: unknown): void {
    debugEmitter.emitDebug('goal.completed', 'scheduler', { goalId, result });
  },

  // ========== WorkItem Events ==========

  /**
   * Emit workitem.created event.
   */
  workItemCreated(workItem: { id: string; goal_id: string; [key: string]: unknown }): void {
    debugEmitter.emitDebug('workitem.created', 'scheduler', { workItem });
  },

  /**
   * Emit workitem.status_changed event.
   */
  workItemStatusChanged(workItemId: string, from: string, to: string): void {
    debugEmitter.emitDebug('workitem.status_changed', 'scheduler', { workItemId, from, to });
  },

  /**
   * Emit workitem.assigned event.
   */
  workItemAssigned(workItemId: string, lane: string): void {
    debugEmitter.emitDebug('workitem.assigned', 'scheduler', { workItemId, lane });
  },

  // ========== Run Events ==========

  /**
   * Emit run.started event.
   */
  runStarted(run: { id: string; work_item_id: string; [key: string]: unknown }): void {
    debugEmitter.emitDebug('run.started', 'scheduler', { run });
  },

  /**
   * Emit run.completed event.
   */
  runCompleted(runId: string, result?: unknown): void {
    debugEmitter.emitDebug('run.completed', 'scheduler', { runId, result });
  },

  /**
   * Emit run.failed event.
   */
  runFailed(runId: string, error: unknown): void {
    debugEmitter.emitDebug('run.failed', 'scheduler', { runId, error: serializeError(error) });
  },

  // ========== LLM Events ==========

  /**
   * Emit llm.request event.
   */
  llmRequest(
    requestId: string,
    model: string,
    messages: unknown[],
    options?: unknown
  ): void {
    debugEmitter.emitDebug('llm.request', 'llm-provider', {
      requestId,
      model,
      messageCount: Array.isArray(messages) ? messages.length : 0,
      options,
    });
  },

  /**
   * Emit llm.response event.
   */
  llmResponse(
    requestId: string,
    model: string,
    response: unknown,
    durationMs: number
  ): void {
    debugEmitter.emitDebug('llm.response', 'llm-provider', {
      requestId,
      model,
      durationMs,
      response,
    });
  },

  /**
   * Emit llm.error event.
   */
  llmError(requestId: string, model: string, error: unknown): void {
    debugEmitter.emitDebug('llm.error', 'llm-provider', {
      requestId,
      model,
      error: serializeError(error),
    });
  },

  /**
   * Emit llm.tokens event.
   */
  llmTokens(
    requestId: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): void {
    debugEmitter.emitDebug('llm.tokens', 'llm-provider', {
      requestId,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });
  },

  // ========== Tool Events ==========

  /**
   * Emit tool.invoke event.
   */
  toolInvoke(invocationId: string, toolName: string, args: unknown): void {
    debugEmitter.emitDebug('tool.invoke', 'tool-registry', {
      invocationId,
      toolName,
      args: truncateData(args),
    });
  },

  /**
   * Emit tool.result event.
   */
  toolResult(
    invocationId: string,
    toolName: string,
    result: unknown,
    durationMs: number
  ): void {
    debugEmitter.emitDebug('tool.result', 'tool-registry', {
      invocationId,
      toolName,
      result: truncateData(result),
      durationMs,
    });
  },

  /**
   * Emit tool.error event.
   */
  toolError(invocationId: string, toolName: string, error: unknown): void {
    debugEmitter.emitDebug('tool.error', 'tool-registry', {
      invocationId,
      toolName,
      error: serializeError(error),
    });
  },

  // ========== State Events ==========

  /**
   * Emit state.transition event.
   */
  stateTransition(
    entityType: string,
    entityId: string,
    from: string,
    to: string
  ): void {
    debugEmitter.emitDebug('state.transition', 'state-machine', {
      entityType,
      entityId,
      from,
      to,
    });
  },

  // ========== System Events ==========

  /**
   * Emit system.startup event.
   */
  systemStartup(config?: unknown): void {
    debugEmitter.emitDebug('system.startup', 'gateway', { config });
  },

  /**
   * Emit system.shutdown event.
   */
  systemShutdown(reason?: string): void {
    debugEmitter.emitDebug('system.shutdown', 'gateway', { reason });
  },

  /**
   * Emit system.error event.
   */
  systemError(source: string, error: unknown): void {
    debugEmitter.emitDebug('system.error', source, { error: serializeError(error) });
  },

  // ========== Generic Events ==========

  /**
   * Emit a custom event.
   */
  custom(type: string, source: string, data: Record<string, unknown>): void {
    debugEmitter.emitDebug(type, source, data);
  },
};

/**
 * Serialize an error object for safe JSON transmission.
 */
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>;
  }
  return { message: String(error) };
}

/**
 * Truncate large data to prevent oversized events.
 * Limits strings to 4KB and arrays to 100 elements.
 */
function truncateData(data: unknown, maxStringLength = 4096, maxArrayLength = 100): unknown {
  if (typeof data === 'string') {
    if (data.length > maxStringLength) {
      return data.substring(0, maxStringLength) + ' [truncated]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length > maxArrayLength) {
      return {
        _truncated: true,
        count: data.length,
        sample: data.slice(0, maxArrayLength).map((item) => truncateData(item, maxStringLength, maxArrayLength)),
      };
    }
    return data.map((item) => truncateData(item, maxStringLength, maxArrayLength));
  }

  if (typeof data === 'object' && data !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = truncateData(value, maxStringLength, maxArrayLength);
    }
    return result;
  }

  return data;
}
