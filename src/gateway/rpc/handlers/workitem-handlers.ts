/**
 * WorkItem Handlers - RPC handlers for work item operations
 */

import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { WorkItem, WorkItemStatus } from '../../../work-order/types/index.js';
import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError } from '../../errors.js';

export interface WorkItemListParams {
  goalId?: string;
  status?: WorkItemStatus;
  limit?: number;
  offset?: number;
}

export interface WorkItemGetParams {
  workItemId: string;
}

export interface WorkItemsByGoalParams {
  goalId: string;
}

export interface WorkItemRetryParams {
  workItemId: string;
}

function listAllWorkItems(repository: IWorkOrderRepository): WorkItem[] {
  const goals = repository.listGoals();
  const byId = new Map<string, WorkItem>();

  for (const goal of goals) {
    const workItems = repository.getWorkItemsByGoal(goal.id);
    for (const workItem of workItems) {
      byId.set(workItem.id, workItem);
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => b.updated_at - a.updated_at);
}

export function registerWorkItemHandlers(
  rpcHandler: RpcHandler,
  repository: IWorkOrderRepository
): void {
  // workitem.get - Get a specific work item
  rpcHandler.register<WorkItemGetParams, WorkItem>(
    'workitem.get',
    ['read'],
    async (params) => {
      if (!params.workItemId) {
        throw GatewayError.invalidParams('workItemId is required');
      }

      const workItem = repository.getWorkItem(params.workItemId);
      if (!workItem) {
        throw GatewayError.notFound('workitem', params.workItemId);
      }

      return workItem;
    }
  );

  // workitem.list - List work items with optional filters
  rpcHandler.register<WorkItemListParams, { workItems: WorkItem[]; total: number }>(
    'workitem.list',
    ['read'],
    async (params) => {
      let workItems: WorkItem[];

      if (params.goalId) {
        workItems = repository.getWorkItemsByGoal(params.goalId);
      } else {
        workItems = listAllWorkItems(repository);
      }

      // Filter by status if provided
      if (params.status) {
        workItems = workItems.filter(wi => wi.status === params.status);
      }

      // Apply pagination
      const offset = params.offset || 0;
      const limit = params.limit || 50;
      const total = workItems.length;
      const paginatedItems = workItems.slice(offset, offset + limit);

      return {
        workItems: paginatedItems,
        total,
      };
    }
  );

  // workitem.byGoal - Get all work items for a goal
  rpcHandler.register<WorkItemsByGoalParams, { workItems: WorkItem[] }>(
    'workitem.byGoal',
    ['read'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      const workItems = repository.getWorkItemsByGoal(params.goalId);

      return { workItems };
    }
  );

  // workitem.runs - Get runs for a work item
  rpcHandler.register<WorkItemGetParams, { runs: unknown[] }>(
    'workitem.runs',
    ['read'],
    async (params) => {
      if (!params.workItemId) {
        throw GatewayError.invalidParams('workItemId is required');
      }

      const workItem = repository.getWorkItem(params.workItemId);
      if (!workItem) {
        throw GatewayError.notFound('workitem', params.workItemId);
      }

      const runs = repository.getRunsByWorkItem(params.workItemId);

      return { runs };
    }
  );

  rpcHandler.register<WorkItemRetryParams, { success: boolean; workItem: WorkItem }>(
    'workitem.retry',
    ['write'],
    async (params) => {
      if (!params.workItemId) {
        throw GatewayError.invalidParams('workItemId is required');
      }

      const workItem = repository.getWorkItem(params.workItemId);
      if (!workItem) {
        throw GatewayError.notFound('workitem', params.workItemId);
      }

      if (workItem.status !== 'failed' && workItem.status !== 'blocked') {
        throw GatewayError.invalidParams(`workitem.retry only supports failed/blocked items. Current status: ${workItem.status}`);
      }

      repository.incrementWorkItemRetry(workItem.id);
      repository.updateWorkItemStatus(workItem.id, 'queued');
      repository.updateWorkItemStatusIfDependenciesMet(workItem.id);
      repository.updateGoalStatus(workItem.goal_id, 'queued');

      const updated = repository.getWorkItem(workItem.id);
      if (!updated) {
        throw GatewayError.notFound('workitem', workItem.id);
      }

      return { success: true, workItem: updated };
    }
  );
}
