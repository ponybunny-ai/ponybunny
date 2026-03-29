import { randomUUID } from 'crypto';
import type { EventBus as RuntimeEventBus, RuntimeEvent } from '../event-bus/index.js';
import { runtimeEventBus } from '../event-bus/index.js';
import type {
  ExecutionPort,
  ExecutionRequest,
  ExecutionResult,
  FailedExecutionResult,
  ExecutionError,
} from '../execution-boundary/index.js';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';

const EXECUTION_WORKER_SOURCE = 'local-execution-worker';

/**
 * `task.ready` currently carries the normalized execution boundary request directly.
 * Later sessions can make the scheduler publish this payload without inventing a second
 * execution command shape.
 */
export type TaskReadyEventPayload = ExecutionRequest;

interface ExecutionWorkerFailurePayload {
  request: ExecutionRequest;
  error: ExecutionError;
  result: FailedExecutionResult;
}

export class LocalExecutionWorker {
  private subscribed = false;
  private started = false;
  private readonly processedRunIds = new Set<string>();
  private readonly logger: ILogger;

  constructor(
    private readonly executionPort: ExecutionPort,
    private readonly bus: RuntimeEventBus = runtimeEventBus,
    logger: ILogger = new NoopLogger()
  ) {
    this.logger = logger.child({ component: 'LocalExecutionWorker' });
  }

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

      const failedResult = this.normalizeFailedExecutionResult(request, result.error ?? {
        code: 'EXECUTION_FAILED',
        message: 'Execution failed without an error payload',
        recoverable: true,
      }, result);
      await this.publishExecutionFailed(request, failedResult);
    } catch (error) {
      const failedResult = this.normalizeFailedExecutionResult(request, {
        code: 'EXECUTION_WORKER_EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
      await this.publishExecutionFailed(request, failedResult);
    }
  }

  private parseTaskReadyEvent(event: RuntimeEvent): ExecutionRequest | null {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      this.logger.warn({}, 'Ignoring task.ready event without ExecutionRequest payload');
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
      this.logger.warn({}, 'Ignoring task.ready event with invalid ExecutionRequest payload');
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
    result: FailedExecutionResult
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
        error: result.error,
        result,
      } satisfies ExecutionWorkerFailurePayload,
    });
  }

  private normalizeFailedExecutionResult(
    request: ExecutionRequest,
    error: ExecutionError,
    result?: ExecutionResult
  ): FailedExecutionResult {
    return {
      runId: request.runId,
      goalId: request.goalId,
      workItemId: request.workItemId,
      source: EXECUTION_WORKER_SOURCE,
      success: false,
      outcome: 'failure',
      tokensUsed: result?.success === false ? result.tokensUsed : 0,
      timeSeconds: result?.success === false ? result.timeSeconds : 0,
      costUsd: result?.success === false ? result.costUsd : 0,
      artifacts: result?.success === false ? result.artifacts : [],
      actualModel: result?.success === false ? result.actualModel : undefined,
      endpointId: result?.success === false ? result.endpointId : undefined,
      error: result?.success === false && result.error ? result.error : error,
    };
  }
}
