/**
 * Execution Engine Adapter
 *
 * Adapts the existing ExecutionService to IExecutionEngineAdapter interface
 * required by SchedulerCore.
 */

import type { WorkItem } from '../../work-order/types/index.js';
import type { LaneId } from '../../scheduler/types.js';
import type { IExecutionEngineAdapter } from '../../scheduler/core/types.js';
import type { IExecutionService } from '../../app/lifecycle/stage-interfaces.js';

interface ExecutionContext {
  model: string;
  laneId: LaneId;
  budgetRemaining: unknown;
}

interface ExecutionResult {
  success: boolean;
  tokensUsed: number;
  timeSeconds: number;
  costUsd: number;
  artifacts: string[];
  error?: { code: string; message: string; recoverable: boolean };
}

/**
 * Tracks active executions for abort support
 */
interface ActiveExecution {
  runId: string;
  workItemId: string;
  abortController: AbortController;
  startedAt: number;
}

export class ExecutionEngineAdapter implements IExecutionEngineAdapter {
  private activeExecutions: Map<string, ActiveExecution> = new Map();

  constructor(private executionService: IExecutionService) {}

  async execute(workItem: WorkItem, _context: ExecutionContext): Promise<ExecutionResult> {
    const abortController = new AbortController();

    // We'll use workItem.id as a temporary runId until we get the real one
    // The actual run is created inside ExecutionService
    const tempRunId = `pending-${workItem.id}-${Date.now()}`;

    // Track this execution
    this.activeExecutions.set(tempRunId, {
      runId: tempRunId,
      workItemId: workItem.id,
      abortController,
      startedAt: Date.now(),
    });

    try {
      // Execute using the existing service
      const result = await this.executionService.executeWorkItem(workItem);

      // Update tracking with real run ID
      this.activeExecutions.delete(tempRunId);

      return {
        success: result.success,
        tokensUsed: result.run.tokens_used ?? 0,
        timeSeconds: result.run.time_seconds ?? 0,
        costUsd: result.run.cost_usd ?? 0,
        artifacts: result.run.artifacts,
        error: result.success
          ? undefined
          : {
              code: result.errorSignature || 'EXECUTION_ERROR',
              message: result.run.error_message || 'Unknown error',
              recoverable: result.needsRetry,
            },
      };
    } catch (error) {
      this.activeExecutions.delete(tempRunId);

      return {
        success: false,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
        error: {
          code: 'EXECUTION_EXCEPTION',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
      };
    }
  }

  async abort(runId: string): Promise<void> {
    // Find execution by runId or workItemId pattern
    for (const [key, execution] of this.activeExecutions) {
      if (key === runId || execution.runId === runId) {
        execution.abortController.abort();
        this.activeExecutions.delete(key);
        return;
      }
    }

    // If not found, it may have already completed
    console.warn(`[ExecutionEngineAdapter] No active execution found for runId: ${runId}`);
  }

  /**
   * Get count of active executions (for monitoring)
   */
  getActiveCount(): number {
    return this.activeExecutions.size;
  }
}
