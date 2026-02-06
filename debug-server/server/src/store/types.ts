/**
 * Debug Data Store interface.
 */

import type {
  EnrichedEvent,
  EventFilter,
  CachedGoal,
  CachedWorkItem,
  CachedRun,
  AggregatedMetrics,
  GoalFilter,
  TimeRange,
} from '../types.js';

/**
 * Interface for debug data persistence.
 */
export interface IDebugDataStore {
  // Event storage
  saveEvent(event: EnrichedEvent): void;
  queryEvents(filter: EventFilter): EnrichedEvent[];
  getEventCount(): number;

  // Entity cache (Goal, WorkItem, Run latest state)
  upsertGoal(goal: CachedGoal): void;
  upsertWorkItem(workItem: CachedWorkItem): void;
  upsertRun(run: CachedRun): void;

  getGoal(id: string): CachedGoal | null;
  getGoals(filter?: GoalFilter): CachedGoal[];
  getWorkItems(goalId?: string): CachedWorkItem[];
  getRuns(workItemId?: string): CachedRun[];

  // Aggregated data
  saveMetrics(metrics: AggregatedMetrics): void;
  queryMetrics(timeRange: TimeRange): AggregatedMetrics[];

  // Maintenance
  cleanupOldEvents(retentionDays: number): number;
  close(): void;
}
