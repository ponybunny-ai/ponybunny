/**
 * Lane Selector Types
 */

import type { LaneId, LaneConfig, LaneStatus } from '../types.js';
import type { Goal, WorkItem } from '../../work-order/types/index.js';

export interface LaneSelectorConfig {
  lanes: Record<LaneId, LaneConfig>;
}

export interface LaneSelectionResult {
  laneId: LaneId;
  reason: string;
}

export interface ILaneSelector {
  /** Select appropriate lane for a work item */
  selectLane(workItem: WorkItem, goal: Goal): LaneSelectionResult;

  /** Get lane configuration */
  getLaneConfig(laneId: LaneId): LaneConfig;

  /** Get all lane configurations */
  getAllLaneConfigs(): Record<LaneId, LaneConfig>;

  /** Get lane status */
  getLaneStatus(laneId: LaneId): LaneStatus;

  /** Get all lane statuses */
  getAllLaneStatuses(): Record<LaneId, LaneStatus>;

  /** Check if lane has capacity */
  hasCapacity(laneId: LaneId): boolean;

  /** Increment active count for a lane */
  incrementActive(laneId: LaneId): void;

  /** Decrement active count for a lane */
  decrementActive(laneId: LaneId): void;

  /** Add to queue count for a lane */
  incrementQueued(laneId: LaneId): void;

  /** Remove from queue count for a lane */
  decrementQueued(laneId: LaneId): void;
}
