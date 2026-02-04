/**
 * Work Item Manager Module
 *
 * Manages work item lifecycle, dependencies, and DAG validation.
 */

export type {
  DAGValidationResult,
  DependencyStatus,
  WorkItemTransition,
  IWorkItemManager,
} from './types.js';

export { WorkItemManager, type IWorkItemRepository } from './work-item-manager.js';
