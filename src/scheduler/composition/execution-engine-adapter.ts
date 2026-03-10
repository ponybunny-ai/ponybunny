/**
 * Scheduler-owned compatibility wrapper for the pre-session10 execution adapter shape.
 *
 * SchedulerCore now depends on ExecutionPort via LocalExecutionAdapter.
 * This class preserves the older execute(workItem, context) surface for
 * callers and tests that still need the legacy adapter contract.
 */

import type { WorkItem } from '../../work-order/types/index.js';
import type { LaneId } from '../../scheduler/types.js';
import type { ExecutionRunner } from '../../runtime/execution-boundary/index.js';
import { LocalExecutionAdapter } from '../../runtime/execution-boundary/index.js';

interface LegacyExecutionContext {
  model: string;
  laneId: LaneId;
  budgetRemaining: unknown;
}

export class ExecutionEngineAdapter {
  private delegate: LocalExecutionAdapter;

  constructor(executionRunner: ExecutionRunner) {
    this.delegate = new LocalExecutionAdapter(executionRunner);
  }

  async execute(workItem: WorkItem, context: LegacyExecutionContext) {
    const runId = `pending-${workItem.id}-${Date.now()}`;
    return this.delegate.execute({
      runId,
      goalId: workItem.goal_id,
      workItemId: workItem.id,
      workItem,
      model: context.model,
      laneId: context.laneId,
      budgetRemaining: context.budgetRemaining,
    });
  }

  async abort(runId: string): Promise<void> {
    await this.delegate.abort(runId);
  }

  getActiveCount(): number {
    return this.delegate.getActiveCount();
  }
}
