/**
 * Debug Server type definitions.
 */

/**
 * Debug event received from Gateway.
 */
export interface DebugEvent {
  id: string;
  timestamp: number;
  type: string;
  source: string;
  data: Record<string, unknown>;
  goalId?: string;
  workItemId?: string;
  runId?: string;
}

/**
 * Enriched event with additional computed fields.
 */
export interface EnrichedEvent extends DebugEvent {
  duration?: number;
}

/**
 * Goal entity cached from events.
 */
export interface CachedGoal {
  id: string;
  status: string;
  title?: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

/**
 * WorkItem entity cached from events.
 */
export interface CachedWorkItem {
  id: string;
  goalId: string;
  status: string;
  title?: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

/**
 * Run entity cached from events.
 */
export interface CachedRun {
  id: string;
  workItemId: string;
  status: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

/**
 * Aggregated metrics for a time window.
 */
export interface AggregatedMetrics {
  windowStart: number;
  windowEnd: number;
  data: {
    eventCounts: Record<string, number>;
    llmTokens?: {
      input: number;
      output: number;
      total: number;
    };
    toolInvocations?: number;
    goalStats?: {
      created: number;
      completed: number;
      failed: number;
    };
  };
}

/**
 * Filter options for querying events.
 */
export interface EventFilter {
  type?: string;
  source?: string;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

/**
 * Filter options for querying goals.
 */
export interface GoalFilter {
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Time range for metrics queries.
 */
export interface TimeRange {
  start: number;
  end: number;
}

/**
 * Debug Server configuration.
 */
export interface DebugServerConfig {
  gateway: {
    url: string;
    reconnect: boolean;
  };
  storage: {
    dbPath: string;
    retention?: {
      eventsDays: number;
    };
  };
  server: {
    port: number;
    host: string;
  };
  aggregation: {
    metricsWindow: number;
  };
}

/**
 * Snapshot state structure.
 */
export interface SnapshotState {
  goal: CachedGoal;
  workItems: CachedWorkItem[];
  runs: CachedRun[];
  metrics: AggregatedMetrics;
  llmContext: {
    activeRequests: Array<{id: string; model: string; startTime: number}>;
    totalTokens: {input: number; output: number};
  };
}

/**
 * Snapshot metadata.
 */
export interface Snapshot {
  id: string;
  goalId: string;
  timestamp: number;
  triggerType: 'goal_start' | 'phase_transition' | 'error' | 'manual' | 'time_based';
  triggerEventId?: string;
  stateData: Buffer;
  sizeBytes: number;
  createdAt: number;
}

/**
 * Timeline metadata for a goal.
 */
export interface TimelineMetadata {
  goalId: string;
  totalEvents: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  phaseBoundaries: Array<{phase: string; startTime: number; endTime: number}>;
  errorMarkers: Array<{eventId: string; timestamp: number}>;
  llmCallSpans: Array<{id: string; startTime: number; endTime: number; model: string; tokens: number}>;
  lastUpdated: number;
}

/**
 * State change description.
 */
export interface StateChange {
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * State diff between two snapshots.
 */
export interface StateDiff {
  changes: StateChange[];
}

/**
 * Replay state result.
 */
export interface ReplayState {
  timestamp: number;
  state: SnapshotState;
  snapshotUsed?: number;
  eventsReplayed: number;
}

/**
 * Replay session control messages.
 */
export type ReplayControlMessage =
  | { type: 'replay.start'; goalId: string; speed: number }
  | { type: 'replay.pause' }
  | { type: 'replay.resume' }
  | { type: 'replay.seek'; timestamp: number }
  | { type: 'replay.step'; direction: 'forward' | 'backward' }
  | { type: 'replay.speed'; speed: number }
  | { type: 'replay.stop' };

/**
 * Replay event messages sent to clients.
 */
export type ReplayEventMessage =
  | { type: 'replay.event'; event: EnrichedEvent; state: SnapshotState; diff: StateDiff }
  | { type: 'replay.batch'; events: Array<{event: EnrichedEvent; state: SnapshotState; diff: StateDiff}> }
  | { type: 'replay.complete' }
  | { type: 'replay.error'; error: string };

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: DebugServerConfig = {
  gateway: {
    url: 'ws://127.0.0.1:18789',
    reconnect: true,
  },
  storage: {
    dbPath: '',  // Will be set based on home directory
    retention: {
      eventsDays: 7,
    },
  },
  server: {
    port: 18790,
    host: '127.0.0.1',
  },
  aggregation: {
    metricsWindow: 300000,  // 5 minutes
  },
};
