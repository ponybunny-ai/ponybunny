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
  Snapshot,
  SnapshotState,
  TimelineMetadata,
} from '../types.js';

/**
 * Interface for debug data persistence.
 */
export interface IDebugDataStore {
  // Event storage
  saveEvent(event: EnrichedEvent): void;
  queryEvents(filter: EventFilter): EnrichedEvent[];
  getEventCount(): number;
  getEvent(eventId: string): EnrichedEvent | null;
  countEvents(goalId: string, startTime: number, endTime: number): number;

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

  // Replay - Snapshots
  saveSnapshot(snapshot: Snapshot): void;
  getSnapshot(id: string): Snapshot | null;
  getNearestSnapshot(goalId: string, beforeTimestamp: number): Snapshot | null;
  listSnapshots(goalId: string): Snapshot[];
  deleteOldSnapshots(goalId: string, keepCount: number): number;

  // Replay - Timeline Metadata
  saveTimelineMetadata(metadata: TimelineMetadata): void;
  getTimelineMetadata(goalId: string): TimelineMetadata | null;

  // Maintenance
  cleanupOldEvents(retentionDays: number): number;
  close(): void;
}
