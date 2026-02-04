/**
 * Lane Selector Implementation
 *
 * Assigns work items to appropriate execution lanes based on their characteristics.
 */

import type { LaneId, LaneConfig, LaneStatus } from '../types.js';
import type { Goal, WorkItem } from '../../work-order/types/index.js';
import type { ILaneSelector, LaneSelectionResult } from './types.js';
import { DEFAULT_LANE_CONFIGS, getAllLaneIds } from './lane-config.js';

export class LaneSelector implements ILaneSelector {
  private configs: Record<LaneId, LaneConfig>;
  private statuses: Record<LaneId, LaneStatus>;

  constructor(configs?: Partial<Record<LaneId, Partial<LaneConfig>>>) {
    // Merge custom configs with defaults
    this.configs = { ...DEFAULT_LANE_CONFIGS };
    if (configs) {
      for (const [laneId, config] of Object.entries(configs)) {
        if (config && laneId in this.configs) {
          this.configs[laneId as LaneId] = {
            ...this.configs[laneId as LaneId],
            ...config,
          };
        }
      }
    }

    // Initialize statuses
    this.statuses = {} as Record<LaneId, LaneStatus>;
    for (const laneId of getAllLaneIds()) {
      this.statuses[laneId] = {
        laneId,
        activeCount: 0,
        queuedCount: 0,
        isAvailable: true,
      };
    }
  }

  /**
   * Select appropriate lane for a work item
   */
  selectLane(workItem: WorkItem, goal: Goal): LaneSelectionResult {
    // Check for explicit lane assignment in context
    const explicitLane = workItem.context?.lane as LaneId | undefined;
    if (explicitLane && explicitLane in this.configs) {
      return {
        laneId: explicitLane,
        reason: 'Explicitly assigned lane',
      };
    }

    // Session lane: interactive or long-running tasks
    if (this.isSessionTask(workItem, goal)) {
      return {
        laneId: 'session',
        reason: 'Interactive or long-running task requiring dedicated session',
      };
    }

    // Cron lane: scheduled or recurring tasks
    if (this.isCronTask(workItem, goal)) {
      return {
        laneId: 'cron',
        reason: 'Scheduled or recurring background task',
      };
    }

    // Subagent lane: parallelizable subtasks
    if (this.isSubagentTask(workItem, goal)) {
      // Check if subagent lane has capacity
      if (this.hasCapacity('subagent')) {
        return {
          laneId: 'subagent',
          reason: 'Parallelizable subtask delegated to subagent',
        };
      }
    }

    // Default to main lane
    return {
      laneId: 'main',
      reason: 'Primary execution path',
    };
  }

  /**
   * Check if task should go to session lane
   */
  private isSessionTask(workItem: WorkItem, goal: Goal): boolean {
    // Check context flags
    if (workItem.context?.interactive === true) {
      return true;
    }
    if (workItem.context?.longRunning === true) {
      return true;
    }

    // XL effort tasks might need dedicated session
    if (workItem.estimated_effort === 'XL') {
      return true;
    }

    // Check goal context
    if (goal.context?.sessionRequired === true) {
      return true;
    }

    return false;
  }

  /**
   * Check if task should go to cron lane
   */
  private isCronTask(workItem: WorkItem, goal: Goal): boolean {
    // Check context flags
    if (workItem.context?.scheduled === true) {
      return true;
    }
    if (workItem.context?.recurring === true) {
      return true;
    }

    // Check goal context
    if (goal.context?.cronJob === true) {
      return true;
    }

    return false;
  }

  /**
   * Check if task can be delegated to subagent
   */
  private isSubagentTask(workItem: WorkItem, _goal: Goal): boolean {
    // Check context flags
    if (workItem.context?.parallelizable === true) {
      return true;
    }
    if (workItem.context?.delegatable === true) {
      return true;
    }

    // Small independent tasks can be parallelized
    if (workItem.estimated_effort === 'S' && workItem.dependencies.length === 0) {
      return true;
    }

    // Analysis tasks are often parallelizable
    if (workItem.item_type === 'analysis') {
      return true;
    }

    // Doc tasks are often parallelizable
    if (workItem.item_type === 'doc' && workItem.dependencies.length === 0) {
      return true;
    }

    return false;
  }

  /**
   * Get lane configuration
   */
  getLaneConfig(laneId: LaneId): LaneConfig {
    const config = this.configs[laneId];
    if (!config) {
      throw new Error(`Unknown lane: ${laneId}`);
    }
    return config;
  }

  /**
   * Get all lane configurations
   */
  getAllLaneConfigs(): Record<LaneId, LaneConfig> {
    return { ...this.configs };
  }

  /**
   * Get lane status
   */
  getLaneStatus(laneId: LaneId): LaneStatus {
    const status = this.statuses[laneId];
    if (!status) {
      throw new Error(`Unknown lane: ${laneId}`);
    }
    return { ...status };
  }

  /**
   * Get all lane statuses
   */
  getAllLaneStatuses(): Record<LaneId, LaneStatus> {
    const result = {} as Record<LaneId, LaneStatus>;
    for (const laneId of getAllLaneIds()) {
      result[laneId] = { ...this.statuses[laneId] };
    }
    return result;
  }

  /**
   * Check if lane has capacity for more work
   */
  hasCapacity(laneId: LaneId): boolean {
    const config = this.configs[laneId];
    const status = this.statuses[laneId];

    if (!config || !status) {
      return false;
    }

    return status.isAvailable && status.activeCount < config.maxConcurrency;
  }

  /**
   * Increment active count for a lane
   */
  incrementActive(laneId: LaneId): void {
    if (this.statuses[laneId]) {
      this.statuses[laneId].activeCount++;
      this.updateAvailability(laneId);
    }
  }

  /**
   * Decrement active count for a lane
   */
  decrementActive(laneId: LaneId): void {
    if (this.statuses[laneId] && this.statuses[laneId].activeCount > 0) {
      this.statuses[laneId].activeCount--;
      this.updateAvailability(laneId);
    }
  }

  /**
   * Increment queued count for a lane
   */
  incrementQueued(laneId: LaneId): void {
    if (this.statuses[laneId]) {
      this.statuses[laneId].queuedCount++;
    }
  }

  /**
   * Decrement queued count for a lane
   */
  decrementQueued(laneId: LaneId): void {
    if (this.statuses[laneId] && this.statuses[laneId].queuedCount > 0) {
      this.statuses[laneId].queuedCount--;
    }
  }

  /**
   * Update lane availability based on current state
   */
  private updateAvailability(laneId: LaneId): void {
    const config = this.configs[laneId];
    const status = this.statuses[laneId];

    if (config && status) {
      status.isAvailable = status.activeCount < config.maxConcurrency;
    }
  }

  /**
   * Set lane availability manually (e.g., for maintenance)
   */
  setAvailability(laneId: LaneId, available: boolean): void {
    if (this.statuses[laneId]) {
      this.statuses[laneId].isAvailable = available;
    }
  }

  /**
   * Reset all lane statuses
   */
  reset(): void {
    for (const laneId of getAllLaneIds()) {
      this.statuses[laneId] = {
        laneId,
        activeCount: 0,
        queuedCount: 0,
        isAvailable: true,
      };
    }
  }
}
