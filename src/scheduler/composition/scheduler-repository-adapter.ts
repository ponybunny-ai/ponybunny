/**
 * Scheduler Repository Adapter
 *
 * Adapts IWorkOrderRepository to ISchedulerRepository for scheduler-owned
 * composition without changing repository semantics.
 */

import type { Goal, WorkItem, Run, InFlightRunReconciliationCandidate } from '../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ISchedulerRepository } from '../core/types.js';

export class SchedulerRepositoryAdapter implements ISchedulerRepository {
  constructor(private repository: IWorkOrderRepository) {}

  getGoal(id: string): Goal | undefined {
    return this.repository.getGoal(id);
  }

  updateGoalStatus(id: string, status: Goal['status']): void {
    this.repository.updateGoalStatus(id, status);
  }

  getWorkItemsForGoal(goalId: string): WorkItem[] {
    // Preserve the existing adapter behavior: scheduler composition still relies
    // on ready-item listing rather than widening repository surface area here.
    const readyItems = this.repository.getReadyWorkItems(goalId);
    return readyItems;
  }

  getWorkItem(id: string): WorkItem | undefined {
    return this.repository.getWorkItem(id);
  }

  updateWorkItemStatus(id: string, status: WorkItem['status']): void {
    this.repository.updateWorkItemStatus(id, status);
  }

  createRun(params: {
    work_item_id: string;
    goal_id: string;
    agent_type: string;
    run_sequence: number;
    context?: Record<string, unknown>;
  }): Run {
    return this.repository.createRun(params);
  }

  getRun(id: string): Run | undefined {
    return this.repository.getRun(id);
  }

  precheckEventedManualReplay(id: string) {
    return this.repository.precheckEventedManualReplay(id);
  }

  mergeRunContext(id: string, contextPatch: Record<string, unknown>): void {
    this.repository.mergeRunContext(id, contextPatch);
  }

  claimEventedResultContinuation(id: string, appliedAt?: number) {
    return this.repository.claimEventedResultContinuation(id, appliedAt);
  }

  startEventedManualReplay(
    id: string,
    params?: {
      requestedAt?: number;
      requestedReason?: 'manual_operator_request';
    }
  ) {
    return this.repository.startEventedManualReplay(id, params);
  }

  completeRun(
    id: string,
    params: {
      status: 'success' | 'failure' | 'timeout' | 'aborted';
      tokens_used: number;
      time_seconds: number;
      cost_usd: number;
      artifacts: string[];
      error_message?: string;
      context?: Record<string, unknown>;
    }
  ): void {
    this.repository.completeRun(id, params);
  }

  getRunsByWorkItem(workItemId: string): Run[] {
    return this.repository.getRunsByWorkItem(workItemId);
  }

  listInFlightRunReconciliationCandidates(): InFlightRunReconciliationCandidate[] {
    return this.repository.listInFlightRunReconciliationCandidates();
  }
}
