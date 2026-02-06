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
