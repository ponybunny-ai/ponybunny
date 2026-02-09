// Debug Event Types
export interface DebugEvent {
  id: string;
  timestamp: number;
  type: string;
  source: string;
  data: Record<string, unknown>;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  duration?: number;
}

export interface CachedGoal {
  id: string;
  status: string;
  title?: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

export interface CachedWorkItem {
  id: string;
  goalId: string;
  status: string;
  title?: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

export interface CachedRun {
  id: string;
  workItemId: string;
  status: string;
  data: Record<string, unknown>;
  updatedAt: number;
}

export interface AggregatedMetrics {
  windowStart: number;
  windowEnd: number;
  data: {
    eventCounts: Record<string, number>;
    llmTokens?: { input: number; output: number; total: number };
    toolInvocations?: number;
    goalStats?: { created: number; completed: number; failed: number };
  };
}

export type EventCategory = 'goal' | 'workitem' | 'run' | 'llm' | 'tool' | 'state' | 'system' | 'other';

export interface EventFilter {
  types?: string[];
  sources?: string[];
  goalId?: string;
  workItemId?: string;
  runId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export interface GoalFilter {
  status?: string[];
  limit?: number;
  offset?: number;
}

export interface TimeRange {
  start: number;
  end: number;
  interval?: number;
}

export interface HealthStatus {
  status: string;
  gatewayConnected: boolean;
  eventCount: number;
  uptime?: number;
}

export interface EventsResponse {
  events: DebugEvent[];
  total: number;
}

export interface GoalsResponse {
  goals: CachedGoal[];
}

export interface GoalDetailResponse {
  goal: CachedGoal;
  workItems: CachedWorkItem[];
  events: DebugEvent[];
}

export interface WorkItemsResponse {
  workItems: CachedWorkItem[];
}

export interface RunsResponse {
  runs: CachedRun[];
}

export interface MetricsResponse {
  metrics: AggregatedMetrics[];
  current: AggregatedMetrics;
}

export function categorizeEvent(type: string): EventCategory {
  if (type.includes('goal')) return 'goal';
  if (type.includes('workitem') || type.includes('work_item')) return 'workitem';
  if (type.includes('run')) return 'run';
  if (type.includes('llm') || type.includes('model')) return 'llm';
  if (type.includes('tool')) return 'tool';
  if (type.includes('state') || type.includes('status')) return 'state';
  if (type.includes('system') || type.includes('gateway')) return 'system';
  return 'other';
}

// Replay Types
export interface TimelineMetadata {
  goalId: string;
  totalEvents: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  phaseBoundaries: Array<{ phase: string; startTime: number; endTime: number }>;
  errorMarkers: Array<{ eventId: string; timestamp: number }>;
  llmCallSpans: Array<{ id: string; startTime: number; endTime: number; model: string; tokens: number }>;
  lastUpdated: number;
}

export interface SnapshotState {
  goal: CachedGoal;
  workItems: CachedWorkItem[];
  runs: CachedRun[];
  metrics: AggregatedMetrics;
  llmContext: {
    activeRequests: Array<{ id: string; model: string; startTime: number }>;
    totalTokens: { input: number; output: number };
  };
}

export interface StateChange {
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface StateDiff {
  changes: StateChange[];
}

export interface ReplayState {
  timestamp: number;
  state: SnapshotState;
  snapshotUsed?: number;
  eventsReplayed: number;
}

export interface ReplayEventData {
  event: DebugEvent;
  state: SnapshotState;
  diff: StateDiff;
}
