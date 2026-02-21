/**
 * Work Item Manager Implementation
 *
 * Manages work item lifecycle, dependencies, and DAG validation.
 */

import type { WorkItem, WorkItemStatus } from '../../work-order/types/index.js';
import type {
  IWorkItemManager,
  DAGValidationResult,
  DependencyStatus,
  WorkItemTransition,
} from './types.js';

/**
 * Repository interface for work item persistence
 */
export interface IWorkItemRepository {
  getWorkItem(id: string): WorkItem | undefined;
  getWorkItemsByGoal(goalId: string): WorkItem[];
  updateWorkItemStatus(id: string, status: WorkItemStatus): void;
  updateWorkItemStatusIfDependenciesMet(id: string): void;
}

/**
 * Valid status transitions for work items
 */
const VALID_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  queued: ['ready', 'blocked', 'failed'],
  ready: ['in_progress', 'blocked', 'failed'],
  in_progress: ['queued', 'verify', 'done', 'failed', 'blocked'],
  verify: ['done', 'failed', 'in_progress'],
  done: [], // Terminal state
  failed: ['queued', 'ready'], // Can retry
  blocked: ['queued', 'ready', 'failed'],
};

export class WorkItemManager implements IWorkItemManager {
  private transitions: WorkItemTransition[] = [];

  constructor(private repository: IWorkItemRepository) {}

  /**
   * Get work items that are ready for execution
   */
  async getReadyWorkItems(goalId: string): Promise<WorkItem[]> {
    const allItems = this.repository.getWorkItemsByGoal(goalId);
    const readyItems: WorkItem[] = [];

    for (const item of allItems) {
      if (item.status === 'ready') {
        readyItems.push(item);
      } else if (item.status === 'queued') {
        // Check if dependencies are satisfied
        const satisfied = await this.areDependenciesSatisfied(item);
        if (satisfied) {
          this.repository.updateWorkItemStatusIfDependenciesMet(item.id);
          const refreshedItem = this.repository.getWorkItem(item.id);
          if (refreshedItem && refreshedItem.status === 'ready') {
            readyItems.push(refreshedItem);
          }
        }
      }
    }

    // Sort by priority (higher first), then by creation time (older first)
    return readyItems.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.created_at - b.created_at;
    });
  }

  /**
   * Check if all dependencies of a work item are satisfied (completed)
   */
  async areDependenciesSatisfied(workItem: WorkItem): Promise<boolean> {
    if (!workItem.dependencies || workItem.dependencies.length === 0) {
      return true;
    }

    for (const depId of workItem.dependencies) {
      const dep = this.repository.getWorkItem(depId);
      if (!dep || dep.status !== 'done') {
        return false;
      }
    }

    return true;
  }

  /**
   * Get detailed dependency status for a work item
   */
  async getDependencyStatus(workItem: WorkItem): Promise<DependencyStatus> {
    const pendingDependencies: string[] = [];
    const completedDependencies: string[] = [];
    const failedDependencies: string[] = [];

    for (const depId of workItem.dependencies || []) {
      const dep = this.repository.getWorkItem(depId);
      if (!dep) {
        // Missing dependency is treated as pending
        pendingDependencies.push(depId);
      } else if (dep.status === 'done') {
        completedDependencies.push(depId);
      } else if (dep.status === 'failed') {
        failedDependencies.push(depId);
      } else {
        pendingDependencies.push(depId);
      }
    }

    return {
      workItemId: workItem.id,
      satisfied: pendingDependencies.length === 0 && failedDependencies.length === 0,
      pendingDependencies,
      completedDependencies,
      failedDependencies,
    };
  }

  /**
   * Update work item status with validation
   */
  async updateStatus(
    workItemId: string,
    status: WorkItemStatus,
    reason?: string
  ): Promise<void> {
    const workItem = this.repository.getWorkItem(workItemId);
    if (!workItem) {
      throw new Error(`Work item not found: ${workItemId}`);
    }

    // Validate transition
    if (!this.isValidTransition(workItem.status, status)) {
      throw new Error(
        `Invalid status transition: ${workItem.status} -> ${status} for work item ${workItemId}`
      );
    }

    // Record transition
    this.transitions.push({
      workItemId,
      fromStatus: workItem.status,
      toStatus: status,
      timestamp: Date.now(),
      reason,
    });

    // Update in repository
    this.repository.updateWorkItemStatus(workItemId, status);

    // If completed, check if any blocked items can be unblocked
    if (status === 'done') {
      await this.checkAndUnblockDependents(workItemId);
    }
  }

  /**
   * Get work items that are blocked
   */
  async getBlockedWorkItems(goalId: string): Promise<WorkItem[]> {
    const allItems = this.repository.getWorkItemsByGoal(goalId);
    return allItems.filter((item) => item.status === 'blocked');
  }

  /**
   * Get work items by status
   */
  async getWorkItemsByStatus(
    goalId: string,
    status: WorkItemStatus
  ): Promise<WorkItem[]> {
    const allItems = this.repository.getWorkItemsByGoal(goalId);
    return allItems.filter((item) => item.status === status);
  }

  /**
   * Validate DAG integrity - check for cycles and missing dependencies
   */
  async validateDAG(goalId: string): Promise<DAGValidationResult> {
    const allItems = this.repository.getWorkItemsByGoal(goalId);
    const errors: string[] = [];
    const cycles: string[][] = [];

    // Build adjacency map
    const itemMap = new Map<string, WorkItem>();
    for (const item of allItems) {
      itemMap.set(item.id, item);
    }

    // Check for missing dependencies
    for (const item of allItems) {
      for (const depId of item.dependencies || []) {
        if (!itemMap.has(depId)) {
          errors.push(`Work item ${item.id} has missing dependency: ${depId}`);
        }
      }
    }

    // Detect cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const detectCycle = (itemId: string): boolean => {
      visited.add(itemId);
      recursionStack.add(itemId);
      path.push(itemId);

      const item = itemMap.get(itemId);
      if (item) {
        for (const depId of item.dependencies || []) {
          if (!visited.has(depId)) {
            if (detectCycle(depId)) {
              return true;
            }
          } else if (recursionStack.has(depId)) {
            // Found a cycle
            const cycleStart = path.indexOf(depId);
            const cycle = [...path.slice(cycleStart), depId];
            cycles.push(cycle);
            errors.push(`Cycle detected: ${cycle.join(' -> ')}`);
            return true;
          }
        }
      }

      path.pop();
      recursionStack.delete(itemId);
      return false;
    };

    for (const item of allItems) {
      if (!visited.has(item.id)) {
        detectCycle(item.id);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      cycles: cycles.length > 0 ? cycles : undefined,
    };
  }

  /**
   * Get a single work item by ID
   */
  async getWorkItem(workItemId: string): Promise<WorkItem | null> {
    return this.repository.getWorkItem(workItemId) || null;
  }

  /**
   * Get all work items for a goal
   */
  async getWorkItemsForGoal(goalId: string): Promise<WorkItem[]> {
    return this.repository.getWorkItemsByGoal(goalId);
  }

  /**
   * Check if all work items for a goal are complete
   */
  async areAllWorkItemsComplete(goalId: string): Promise<boolean> {
    const allItems = this.repository.getWorkItemsByGoal(goalId);
    if (allItems.length === 0) {
      return true;
    }
    return allItems.every((item) => item.status === 'done');
  }

  /**
   * Get the next work item to execute (highest priority ready item)
   */
  async getNextWorkItem(goalId: string): Promise<WorkItem | null> {
    const readyItems = await this.getReadyWorkItems(goalId);
    return readyItems.length > 0 ? readyItems[0] : null;
  }

  /**
   * Get transition history for a work item
   */
  getTransitionHistory(workItemId: string): WorkItemTransition[] {
    return this.transitions.filter((t) => t.workItemId === workItemId);
  }

  /**
   * Clear transition history (for testing)
   */
  clearTransitionHistory(): void {
    this.transitions = [];
  }

  /**
   * Check if a status transition is valid
   */
  private isValidTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
    const validTargets = VALID_TRANSITIONS[from];
    return validTargets.includes(to);
  }

  /**
   * Check and unblock work items that depend on the completed item
   */
  private async checkAndUnblockDependents(completedItemId: string): Promise<void> {
    const completedItem = this.repository.getWorkItem(completedItemId);
    if (!completedItem) return;

    // Get all items in the same goal
    const allItems = this.repository.getWorkItemsByGoal(completedItem.goal_id);

    for (const item of allItems) {
      // Skip if not queued or blocked
      if (item.status !== 'queued' && item.status !== 'blocked') {
        continue;
      }

      // Check if this item depends on the completed item
      if (!item.dependencies?.includes(completedItemId)) {
        continue;
      }

      // Check if all dependencies are now satisfied
      const satisfied = await this.areDependenciesSatisfied(item);
      if (satisfied && item.status === 'queued') {
        // Transition to ready
        this.repository.updateWorkItemStatus(item.id, 'ready');
        this.transitions.push({
          workItemId: item.id,
          fromStatus: item.status,
          toStatus: 'ready',
          timestamp: Date.now(),
          reason: `Dependency ${completedItemId} completed`,
        });
      }
    }
  }
}
