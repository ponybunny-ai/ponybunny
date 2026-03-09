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
  inspection: ToolWorkerInspectionRecord;
}

export interface ToolWorkerStartedPayload {
  request: ToolRequest;
  context: ToolWorkerEventContext;
  inspection: ToolWorkerInspectionRecord;
}

export interface ToolWorkerCompletedPayload {
  request: ToolRequest;
  result: ToolResult;
  context: ToolWorkerEventContext;
  inspection: ToolWorkerInspectionRecord;
}

export interface ToolWorkerFailedPayload {
  request: ToolRequest;
  result: ToolResult;
  error: ToolFailure;
  context: ToolWorkerEventContext;
  inspection: ToolWorkerInspectionRecord;
}

export type ToolWorkerInspectionOutcome = 'in_flight' | 'success' | 'failure' | 'invalid';

export interface ToolWorkerInspectionRecord {
  toolRequestId: string;
  runId: string;
  workItemId: string;
  goalId?: string;
  toolCallId: string;
  toolName: string;
  outcome: ToolWorkerInspectionOutcome;
  correlationMatched: boolean;
  duplicateSuppressed: boolean;
  duplicateDispatchCount: number;
  dispatchedAt: number;
  completedAt?: number;
  failureCode?: string;
  failureMessage?: string;
}

export interface ToolWorkerInspectionSnapshot {
  inFlight: ToolWorkerInspectionRecord[];
  recent: ToolWorkerInspectionRecord[];
}

interface ToolWorkerMutableInspectionRecord extends ToolWorkerInspectionRecord {
  sequence: number;
}

export class LocalToolWorker {
  private readonly handledRequests = new Map<string, Promise<ToolResult>>();
  private readonly inspectionsByRequestId = new Map<string, ToolWorkerMutableInspectionRecord>();
  private inspectionSequence = 0;

  constructor(
    private readonly toolPort: ToolPort,
    private readonly bus: RuntimeEventBus = runtimeEventBus
  ) {}

  async dispatch(request: ToolRequest): Promise<ToolResult> {
    const inspection = this.getOrCreateInspection(request);
    const duplicate = this.handledRequests.get(request.toolRequestId);
    if (duplicate) {
      inspection.duplicateSuppressed = true;
      inspection.duplicateDispatchCount += 1;
      return duplicate;
    }

    const invalidRequest = this.validateRequest(request);
    if (invalidRequest) {
      return this.failInvalidRequest(request, inspection, invalidRequest);
    }

    const execution = this.executeRequest(request);
    this.handledRequests.set(request.toolRequestId, execution);
    return execution;
  }

  private async executeRequest(request: ToolRequest): Promise<ToolResult> {
    const context = this.buildContext(request);
    const inspection = this.getOrCreateInspection(request);
    await this.publish('tool.requested', {
      request,
      context,
      inspection: this.cloneInspection(inspection),
    } satisfies ToolWorkerRequestedPayload);
    await this.publish('tool.started', {
      request,
      context,
      inspection: this.cloneInspection(inspection),
    } satisfies ToolWorkerStartedPayload);

    try {
      const result = await this.toolPort.execute(request);
      const normalizedResult = this.normalizeResult(request, result, inspection);

      if (normalizedResult.success) {
        this.completeInspection(inspection, 'success');
        await this.publish('tool.completed', {
          request,
          result: normalizedResult,
          context,
          inspection: this.cloneInspection(inspection),
        } satisfies ToolWorkerCompletedPayload);
        return normalizedResult;
      }

      this.completeInspection(
        inspection,
        normalizedResult.error?.code === 'TOOL_RESULT_MISMATCH' || normalizedResult.error?.code === 'TOOL_RESULT_INVALID'
          ? 'invalid'
          : 'failure',
        normalizedResult.error
      );
      await this.publish('tool.failed', {
        request,
        result: normalizedResult,
        error: normalizedResult.error!,
        context,
        inspection: this.cloneInspection(inspection),
      } satisfies ToolWorkerFailedPayload);
      return normalizedResult;
    } catch (error) {
      const failedResult = this.buildFailedResult(request, {
        code: 'TOOL_WORKER_EXCEPTION',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
      this.completeInspection(inspection, 'failure', failedResult.error);

      await this.publish('tool.failed', {
        request,
        result: failedResult,
        error: failedResult.error!,
        context,
        inspection: this.cloneInspection(inspection),
      } satisfies ToolWorkerFailedPayload);
      return failedResult;
    }
  }

  inspect(): ToolWorkerInspectionSnapshot {
    const records = Array.from(this.inspectionsByRequestId.values())
      .sort((left, right) => left.sequence - right.sequence)
      .map((record) => this.cloneInspection(record));

    return {
      inFlight: records.filter((record) => record.outcome === 'in_flight'),
      recent: records.filter((record) => record.outcome !== 'in_flight'),
    };
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

  private getOrCreateInspection(request: ToolRequest): ToolWorkerMutableInspectionRecord {
    const existing = this.inspectionsByRequestId.get(request.toolRequestId);
    if (existing) {
      return existing;
    }

    const created: ToolWorkerMutableInspectionRecord = {
      toolRequestId: request.toolRequestId,
      runId: request.runId,
      workItemId: request.workItemId,
      goalId: request.goalId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      outcome: 'in_flight',
      correlationMatched: true,
      duplicateSuppressed: false,
      duplicateDispatchCount: 0,
      dispatchedAt: Date.now(),
      sequence: this.inspectionSequence++,
    };

    this.inspectionsByRequestId.set(request.toolRequestId, created);
    return created;
  }

  private completeInspection(
    inspection: ToolWorkerMutableInspectionRecord,
    outcome: Exclude<ToolWorkerInspectionOutcome, 'in_flight'>,
    error?: ToolFailure
  ): void {
    inspection.outcome = outcome;
    inspection.completedAt = Date.now();
    inspection.failureCode = error?.code;
    inspection.failureMessage = error?.message;
  }

  private cloneInspection(record: ToolWorkerInspectionRecord): ToolWorkerInspectionRecord {
    return {
      ...record,
    };
  }

  private validateRequest(request: ToolRequest): ToolFailure | null {
    const missingFields: string[] = [];

    if (!this.isNonEmptyString(request.toolRequestId)) {
      missingFields.push('toolRequestId');
    }
    if (!this.isNonEmptyString(request.runId)) {
      missingFields.push('runId');
    }
    if (!this.isNonEmptyString(request.workItemId)) {
      missingFields.push('workItemId');
    }
    if (!this.isNonEmptyString(request.toolCallId)) {
      missingFields.push('toolCallId');
    }
    if (!this.isNonEmptyString(request.toolName)) {
      missingFields.push('toolName');
    }

    if (missingFields.length === 0) {
      return null;
    }

    return {
      code: 'TOOL_REQUEST_INVALID',
      message: `Invalid tool request identity context: missing ${missingFields.join(', ')}`,
      recoverable: false,
    };
  }

  private async failInvalidRequest(
    request: ToolRequest,
    inspection: ToolWorkerMutableInspectionRecord,
    error: ToolFailure
  ): Promise<ToolResult> {
    const failedResult = this.buildFailedResult(request, error);
    inspection.correlationMatched = false;
    this.completeInspection(inspection, 'invalid', error);

    await this.publish('tool.failed', {
      request,
      result: failedResult,
      error,
      context: this.buildContext(request),
      inspection: this.cloneInspection(inspection),
    } satisfies ToolWorkerFailedPayload);

    return failedResult;
  }

  private normalizeResult(
    request: ToolRequest,
    result: ToolResult,
    inspection: ToolWorkerMutableInspectionRecord
  ): ToolResult {
    const mismatchMessage = this.buildResultMismatchMessage(request, result);
    if (mismatchMessage) {
      inspection.correlationMatched = false;
      return this.buildFailedResult(request, {
        code: 'TOOL_RESULT_MISMATCH',
        message: mismatchMessage,
        recoverable: false,
      });
    }

    inspection.correlationMatched = true;
    if (!result.success && !result.error) {
      return this.buildFailedResult(request, {
        code: 'TOOL_RESULT_INVALID',
        message: `Tool '${request.toolName}' returned a failed result without an error payload`,
        recoverable: false,
      });
    }

    return result;
  }

  private buildResultMismatchMessage(request: ToolRequest, result: ToolResult): string | null {
    const mismatches: string[] = [];

    if (result.toolRequestId !== request.toolRequestId) {
      mismatches.push(`toolRequestId expected ${request.toolRequestId}, received ${result.toolRequestId}`);
    }
    if (result.runId !== request.runId) {
      mismatches.push(`runId expected ${request.runId}, received ${result.runId}`);
    }
    if (result.workItemId !== request.workItemId) {
      mismatches.push(`workItemId expected ${request.workItemId}, received ${result.workItemId}`);
    }
    if (result.toolCallId !== request.toolCallId) {
      mismatches.push(`toolCallId expected ${request.toolCallId}, received ${result.toolCallId}`);
    }
    if (result.toolName !== request.toolName) {
      mismatches.push(`toolName expected ${request.toolName}, received ${result.toolName}`);
    }
    if (typeof request.goalId === 'string' && request.goalId.length > 0 && result.goalId !== request.goalId) {
      mismatches.push(`goalId expected ${request.goalId}, received ${String(result.goalId)}`);
    }

    if (mismatches.length === 0) {
      return null;
    }

    return `Tool result correlation mismatch for '${request.toolName}': ${mismatches.join('; ')}`;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
  }

  private async publish(type: ToolWorkerEventType, payload: ToolWorkerRequestedPayload | ToolWorkerStartedPayload | ToolWorkerCompletedPayload | ToolWorkerFailedPayload): Promise<void> {
    const goalId = payload.context.goalId;
    const runId = payload.context.runId;
    const workItemId = payload.context.workItemId;
    const toolRequestId = payload.context.toolRequestId;
    const toolCallId = payload.context.toolCallId;
    const toolName = payload.context.toolName;

    await this.bus.publish({
      id: randomUUID(),
      type,
      source: TOOL_WORKER_SOURCE,
      timestamp: Date.now(),
      ...(this.isNonEmptyString(runId) ? { runId } : {}),
      ...(this.isNonEmptyString(goalId) ? { goalId } : {}),
      ...(this.isNonEmptyString(workItemId) ? { workItemId } : {}),
      ...(this.isNonEmptyString(toolRequestId) ? { toolRequestId } : {}),
      ...(this.isNonEmptyString(toolCallId) ? { toolCallId } : {}),
      ...(this.isNonEmptyString(toolName) ? { toolName } : {}),
      payload,
    });
  }
}
