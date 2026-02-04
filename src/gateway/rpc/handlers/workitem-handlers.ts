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
        // Get work items for a specific goal
        workItems = repository.getReadyWorkItems(params.goalId);
      } else {
        // Get all ready work items
        workItems = repository.getReadyWorkItems();
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

      const workItems = repository.getReadyWorkItems(params.goalId);

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
}
