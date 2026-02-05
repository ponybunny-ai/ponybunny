/**
 * Scheduler Repository Adapter
 *
 * Adapts IWorkOrderRepository to ISchedulerRepository interface
 * required by SchedulerCore.
 */

import type { Goal, WorkItem, Run } from '../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ISchedulerRepository } from '../../scheduler/core/types.js';

export class SchedulerRepositoryAdapter implements ISchedulerRepository {
  constructor(private repository: IWorkOrderRepository) {}

  getGoal(id: string): Goal | undefined {
    return this.repository.getGoal(id);
  }

  updateGoalStatus(id: string, status: Goal['status']): void {
    this.repository.updateGoalStatus(id, status);
  }

  getWorkItemsForGoal(goalId: string): WorkItem[] {
    // Get all work items for a goal by filtering ready items
    // Note: This is a simplified implementation - may need to add
    // a dedicated method to IWorkOrderRepository for full listing
    const readyItems = this.repository.getReadyWorkItems(goalId);

    // Also get blocked items that might be waiting
    // For now, return ready items - full implementation would need
    // a getAllWorkItemsForGoal method
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
  }): Run {
    return this.repository.createRun(params);
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
    }
  ): void {
    this.repository.completeRun(id, params);
  }

  getRunsByWorkItem(workItemId: string): Run[] {
    return this.repository.getRunsByWorkItem(workItemId);
  }
}
