import { randomUUID } from 'crypto';
import type { EventBus as RuntimeEventBus, RuntimeEvent } from '../event-bus/index.js';
import { runtimeEventBus } from '../event-bus/index.js';
import type { ExecutionPort, ExecutionRequest, ExecutionResult } from '../execution-boundary/index.js';

const EXECUTION_WORKER_SOURCE = 'local-execution-worker';

/**
 * `task.ready` currently carries the normalized execution boundary request directly.
 * Later sessions can make the scheduler publish this payload without inventing a second
 * execution command shape.
 */
export type TaskReadyEventPayload = ExecutionRequest;

interface ExecutionWorkerFailurePayload {
  request: ExecutionRequest;
  error: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

export class LocalExecutionWorker {
  private subscribed = false;
  private started = false;
  private readonly processedRunIds = new Set<string>();

  constructor(
    private readonly executionPort: ExecutionPort,
    private readonly bus: RuntimeEventBus = runtimeEventBus
  ) {}

  start(): void {
    this.started = true;

    if (this.subscribed) {
      return;
    }

    this.subscribed = true;
    this.bus.subscribe('task.ready', (event) => this.handleTaskReady(event));
  }

  stop(): void {
    this.started = false;
  }

  private async handleTaskReady(event: RuntimeEvent): Promise<void> {
    if (!this.started) {
      return;
    }

    const request = this.parseTaskReadyEvent(event);
    if (!request) {
      return;
    }

    if (this.processedRunIds.has(request.runId)) {
      return;
    }
    this.processedRunIds.add(request.runId);

    await this.publishExecutionStarted(request);

    try {
      const result = await this.executionPort.execute(request);
      if (result.success) {
        await this.publishExecutionCompleted(request, result);
        return;
      }

      await this.publishExecutionFailed(request, result.error ?? {
        code: 'EXECUTION_FAILED',
        message: 'Execution failed without an error payload',
        recoverable: true,
      });
    } catch (error) {
      await this.publishExecutionFailed(request, {
        code: 'EXECUTION_WORKER_EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
    }
  }

  private parseTaskReadyEvent(event: RuntimeEvent): ExecutionRequest | null {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      console.warn('[LocalExecutionWorker] Ignoring task.ready event without ExecutionRequest payload');
      return null;
    }

    const request = payload as Partial<ExecutionRequest>;
    if (
      typeof request.runId !== 'string' ||
      request.runId.length === 0 ||
      typeof request.goalId !== 'string' ||
      request.goalId.length === 0 ||
      typeof request.workItemId !== 'string' ||
      request.workItemId.length === 0 ||
      typeof request.model !== 'string' ||
      request.model.length === 0 ||
      typeof request.laneId !== 'string' ||
      request.laneId.length === 0 ||
      !request.workItem
    ) {
      console.warn('[LocalExecutionWorker] Ignoring task.ready event with invalid ExecutionRequest payload');
      return null;
    }

    return request as ExecutionRequest;
  }

  private async publishExecutionStarted(request: ExecutionRequest): Promise<void> {
    await this.bus.publish({
      id: randomUUID(),
      type: 'execution.started',
      source: EXECUTION_WORKER_SOURCE,
      timestamp: Date.now(),
      runId: request.runId,
      goalId: request.goalId,
      workItemId: request.workItemId,
      payload: { request },
    });
  }

  private async publishExecutionCompleted(
    request: ExecutionRequest,
    result: ExecutionResult
  ): Promise<void> {
    await this.bus.publish({
      id: randomUUID(),
      type: 'execution.completed',
      source: EXECUTION_WORKER_SOURCE,
      timestamp: Date.now(),
      runId: request.runId,
      goalId: request.goalId,
      workItemId: request.workItemId,
      payload: { request, result },
    });
  }

  private async publishExecutionFailed(
    request: ExecutionRequest,
    error: ExecutionWorkerFailurePayload['error']
  ): Promise<void> {
    await this.bus.publish({
      id: randomUUID(),
      type: 'execution.failed',
      source: EXECUTION_WORKER_SOURCE,
      timestamp: Date.now(),
      runId: request.runId,
      goalId: request.goalId,
      workItemId: request.workItemId,
      payload: {
        request,
        error,
      } satisfies ExecutionWorkerFailurePayload,
    });
  }
}
