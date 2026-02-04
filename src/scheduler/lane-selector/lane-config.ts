/**
 * Default Lane Configuration
 */

import type { LaneId, LaneConfig } from '../types.js';

export const DEFAULT_LANE_CONFIGS: Record<LaneId, LaneConfig> = {
  main: {
    id: 'main',
    displayName: 'Main',
    description: 'Primary execution path for sequential tasks',
    maxConcurrency: 1,
    defaultPriority: 1,
  },
  subagent: {
    id: 'subagent',
    displayName: 'Subagent',
    description: 'Delegated subtasks that can run in parallel',
    maxConcurrency: 3,
    defaultPriority: 2,
  },
  cron: {
    id: 'cron',
    displayName: 'Cron',
    description: 'Scheduled and recurring background tasks',
    maxConcurrency: 2,
    defaultPriority: 3,
  },
  session: {
    id: 'session',
    displayName: 'Session',
    description: 'Interactive and long-running dedicated tasks',
    maxConcurrency: 1,
    defaultPriority: 1,
  },
};

/**
 * Get lane config by ID
 */
export function getLaneConfig(laneId: LaneId): LaneConfig {
  const config = DEFAULT_LANE_CONFIGS[laneId];
  if (!config) {
    throw new Error(`Unknown lane: ${laneId}`);
  }
  return config;
}

/**
 * Get all lane IDs
 */
export function getAllLaneIds(): LaneId[] {
  return Object.keys(DEFAULT_LANE_CONFIGS) as LaneId[];
}
