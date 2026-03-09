import type { Run, WorkItem } from '../work-order/types/index.js';

export interface EventedDispatchCheckpoint {
  execution_mode: 'evented';
  lane_id?: string;
  dispatched_at: number;
  result_continuation_applied: boolean;
  result_continuation_applied_at?: number;
}

export type EventedStartupReconciliationClassification =
  | 'not_evented_candidate'
  | 'already_terminal_in_db'
  | 'maybe_reattachable'
  | 'likely_orphaned';

export interface EventedStartupReconciliationFinding {
  runId: string;
  goalId: string;
  workItemId: string;
  workItemStatus: WorkItem['status'];
  laneId?: string;
  dispatchedAt?: number;
  classification: EventedStartupReconciliationClassification;
  reason: string;
}

export interface EventedStartupReconciliationSummary {
  startedAt: number;
  scanned: number;
  byClassification: Record<EventedStartupReconciliationClassification, number>;
  findings: EventedStartupReconciliationFinding[];
}

export function buildEventedDispatchCheckpoint(params: {
  laneId?: string;
  dispatchedAt: number;
  resultContinuationApplied: boolean;
  resultContinuationAppliedAt?: number;
}): EventedDispatchCheckpoint {
  return {
    execution_mode: 'evented',
    lane_id: params.laneId,
    dispatched_at: params.dispatchedAt,
    result_continuation_applied: params.resultContinuationApplied,
    result_continuation_applied_at: params.resultContinuationAppliedAt,
  };
}

export function readEventedDispatchCheckpoint(
  context: Run['context']
): EventedDispatchCheckpoint | null {
  const candidate = context?.evented_dispatch;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }

  const checkpoint = candidate as Partial<EventedDispatchCheckpoint>;
  if (
    checkpoint.execution_mode !== 'evented' ||
    typeof checkpoint.dispatched_at !== 'number' ||
    typeof checkpoint.result_continuation_applied !== 'boolean'
  ) {
    return null;
  }

  if (checkpoint.lane_id !== undefined && typeof checkpoint.lane_id !== 'string') {
    return null;
  }

  if (
    checkpoint.result_continuation_applied_at !== undefined &&
    typeof checkpoint.result_continuation_applied_at !== 'number'
  ) {
    return null;
  }

  return checkpoint as EventedDispatchCheckpoint;
}
