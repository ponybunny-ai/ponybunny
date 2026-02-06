/**
 * Debug event types for the instrumentation system.
 */

/**
 * Base debug event structure.
 * All debug events emitted by the system follow this interface.
 */
export interface DebugEvent {
  /** Unique event identifier (UUID) */
  id: string;
  /** Event timestamp in milliseconds */
  timestamp: number;
  /** Event type in format "domain.action" (e.g., "goal.created", "llm.request") */
  type: string;
  /** Source module identifier (e.g., "scheduler", "gateway", "llm-provider") */
  source: string;
  /** Event-specific data payload */
  data: Record<string, unknown>;
  /** Associated Goal ID (if applicable) */
  goalId?: string;
  /** Associated WorkItem ID (if applicable) */
  workItemId?: string;
  /** Associated Run ID (if applicable) */
  runId?: string;
}

/**
 * Context for associating events with Goal/WorkItem/Run hierarchy.
 */
export interface DebugContext {
  goalId?: string;
  workItemId?: string;
  runId?: string;
}

/**
 * Enriched event with additional computed fields.
 * Used by Debug Server after processing raw events.
 */
export interface EnrichedEvent extends DebugEvent {
  /** Duration in milliseconds (for request/response pairs) */
  duration?: number;
}

/**
 * Filter options for querying events.
 */
export interface EventFilter {
  /** Filter by event type (prefix match supported) */
  type?: string;
  /** Filter by source module */
  source?: string;
  /** Filter by Goal ID */
  goalId?: string;
  /** Filter by WorkItem ID */
  workItemId?: string;
  /** Filter by Run ID */
  runId?: string;
  /** Start timestamp (inclusive) */
  startTime?: number;
  /** End timestamp (inclusive) */
  endTime?: number;
  /** Maximum number of events to return */
  limit?: number;
  /** Offset for pagination */
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
 * Aggregated metrics data.
 */
export interface AggregatedMetrics {
  windowStart: number;
  windowEnd: number;
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
}
