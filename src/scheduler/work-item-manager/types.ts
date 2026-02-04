/**
 * Work Item Manager Types
 */

import type { WorkItem, WorkItemStatus } from '../../work-order/types/index.js';

export interface DAGValidationResult {
  valid: boolean;
  errors: string[];
  cycles?: string[][];
}

export interface DependencyStatus {
  workItemId: string;
  satisfied: boolean;
  pendingDependencies: string[];
  completedDependencies: string[];
  failedDependencies: string[];
}

export interface WorkItemTransition {
  workItemId: string;
  fromStatus: WorkItemStatus;
  toStatus: WorkItemStatus;
  timestamp: number;
  reason?: string;
}

export interface IWorkItemManager {
  /** Get next work items ready for execution */
  getReadyWorkItems(goalId: string): Promise<WorkItem[]>;

  /** Check if work item dependencies are satisfied */
  areDependenciesSatisfied(workItem: WorkItem): Promise<boolean>;

  /** Get dependency status for a work item */
  getDependencyStatus(workItem: WorkItem): Promise<DependencyStatus>;

  /** Update work item status with validation */
  updateStatus(workItemId: string, status: WorkItemStatus, reason?: string): Promise<void>;

  /** Get blocked work items */
  getBlockedWorkItems(goalId: string): Promise<WorkItem[]>;

  /** Get work items by status */
  getWorkItemsByStatus(goalId: string, status: WorkItemStatus): Promise<WorkItem[]>;

  /** Validate DAG integrity */
  validateDAG(goalId: string): Promise<DAGValidationResult>;

  /** Get work item by ID */
  getWorkItem(workItemId: string): Promise<WorkItem | null>;

  /** Get all work items for a goal */
  getWorkItemsForGoal(goalId: string): Promise<WorkItem[]>;

  /** Check if all work items for a goal are complete */
  areAllWorkItemsComplete(goalId: string): Promise<boolean>;

  /** Get next work item to execute (highest priority ready item) */
  getNextWorkItem(goalId: string): Promise<WorkItem | null>;
}
