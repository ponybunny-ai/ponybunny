import { randomUUID } from 'crypto';
import type { EventBus as RuntimeEventBus } from '../event-bus/index.js';
import { runtimeEventBus } from '../event-bus/index.js';
import type { ToolFailure, ToolPort, ToolRequest, ToolResult } from '../tool-boundary/index.js';

export const TOOL_WORKER_SOURCE = 'local-tool-worker';

export type ToolWorkerEventType =
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed';

export interface ToolWorkerEventContext {
  toolRequestId: string;
  runId: string;
  workItemId: string;
  goalId?: string;
  toolCallId: string;
  toolName: string;
  source: typeof TOOL_WORKER_SOURCE;
}

export interface ToolWorkerRequestedPayload {
  request: ToolRequest;
  context: ToolWorkerEventContext;
}

export interface ToolWorkerStartedPayload {
  request: ToolRequest;
  context: ToolWorkerEventContext;
}

export interface ToolWorkerCompletedPayload {
  request: ToolRequest;
  result: ToolResult;
  context: ToolWorkerEventContext;
}

export interface ToolWorkerFailedPayload {
  request: ToolRequest;
  result: ToolResult;
  error: ToolFailure;
  context: ToolWorkerEventContext;
}

export class LocalToolWorker {
  private readonly handledRequests = new Map<string, Promise<ToolResult>>();

  constructor(
    private readonly toolPort: ToolPort,
    private readonly bus: RuntimeEventBus = runtimeEventBus
  ) {}

  async dispatch(request: ToolRequest): Promise<ToolResult> {
    const duplicate = this.handledRequests.get(request.toolRequestId);
    if (duplicate) {
      return duplicate;
    }

    const execution = this.executeRequest(request);
    this.handledRequests.set(request.toolRequestId, execution);
    return execution;
  }

  private async executeRequest(request: ToolRequest): Promise<ToolResult> {
    const context = this.buildContext(request);
    await this.publish('tool.requested', {
      request,
      context,
    } satisfies ToolWorkerRequestedPayload);
    await this.publish('tool.started', {
      request,
      context,
    } satisfies ToolWorkerStartedPayload);

    try {
      const result = await this.toolPort.execute(request);
      if (result.success) {
        await this.publish('tool.completed', {
          request,
          result,
          context,
        } satisfies ToolWorkerCompletedPayload);
        return result;
      }

      await this.publish('tool.failed', {
        request,
        result,
        error: result.error ?? {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'Tool execution failed without an error payload',
          recoverable: true,
        },
        context,
      } satisfies ToolWorkerFailedPayload);
      return result;
    } catch (error) {
      const failedResult = this.buildFailedResult(request, {
        code: 'TOOL_WORKER_EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });

      await this.publish('tool.failed', {
        request,
        result: failedResult,
        error: failedResult.error!,
        context,
      } satisfies ToolWorkerFailedPayload);
      return failedResult;
    }
  }

  private buildContext(request: ToolRequest): ToolWorkerEventContext {
    return {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      source: TOOL_WORKER_SOURCE,
    };
  }

  private buildFailedResult(request: ToolRequest, error: ToolFailure): ToolResult {
    return {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      success: false,
      error,
    };
  }

  private async publish(type: ToolWorkerEventType, payload: ToolWorkerRequestedPayload | ToolWorkerStartedPayload | ToolWorkerCompletedPayload | ToolWorkerFailedPayload): Promise<void> {
    await this.bus.publish({
      id: randomUUID(),
      type,
      source: TOOL_WORKER_SOURCE,
      timestamp: Date.now(),
      runId: payload.context.runId,
      goalId: payload.context.goalId,
      workItemId: payload.context.workItemId,
      toolRequestId: payload.context.toolRequestId,
      toolCallId: payload.context.toolCallId,
      toolName: payload.context.toolName,
      payload,
    });
  }
}
