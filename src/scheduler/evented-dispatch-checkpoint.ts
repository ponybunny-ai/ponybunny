import type { Run, WorkItem } from '../work-order/types/index.js';

export interface EventedDispatchCheckpoint {
  execution_mode: 'evented';
  lane_id?: string;
  dispatched_at: number;
  result_continuation_applied: boolean;
  result_continuation_applied_at?: number;
  orphan_classification?: 'stale_timeout';
  orphan_detected_at?: number;
  recovery_candidate?: boolean;
  recovery_candidate_marked_at?: number;
  recovery_candidate_reason?: 'manual_operator_mark';
  replay_candidate?: boolean;
  replay_candidate_marked_at?: number;
  replay_candidate_reason?: 'manual_operator_mark';
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
  ageMs?: number;
  staleTimeoutExceeded: boolean;
  classification: EventedStartupReconciliationClassification;
  reason: string;
}

export interface EventedStartupReconciliationSummary {
  startedAt: number;
  scanned: number;
  staleTimeoutExceeded: number;
  byClassification: Record<EventedStartupReconciliationClassification, number>;
  findings: EventedStartupReconciliationFinding[];
}

export function buildEventedDispatchCheckpoint(params: {
  laneId?: string;
  dispatchedAt: number;
  resultContinuationApplied: boolean;
  resultContinuationAppliedAt?: number;
  orphanClassification?: 'stale_timeout';
  orphanDetectedAt?: number;
  recoveryCandidate?: boolean;
  recoveryCandidateMarkedAt?: number;
  recoveryCandidateReason?: 'manual_operator_mark';
  replayCandidate?: boolean;
  replayCandidateMarkedAt?: number;
  replayCandidateReason?: 'manual_operator_mark';
}): EventedDispatchCheckpoint {
  return {
    execution_mode: 'evented',
    lane_id: params.laneId,
    dispatched_at: params.dispatchedAt,
    result_continuation_applied: params.resultContinuationApplied,
    result_continuation_applied_at: params.resultContinuationAppliedAt,
    orphan_classification: params.orphanClassification,
    orphan_detected_at: params.orphanDetectedAt,
    recovery_candidate: params.recoveryCandidate,
    recovery_candidate_marked_at: params.recoveryCandidateMarkedAt,
    recovery_candidate_reason: params.recoveryCandidateReason,
    replay_candidate: params.replayCandidate,
    replay_candidate_marked_at: params.replayCandidateMarkedAt,
    replay_candidate_reason: params.replayCandidateReason,
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

  if (
    checkpoint.orphan_classification !== undefined &&
    checkpoint.orphan_classification !== 'stale_timeout'
  ) {
    return null;
  }

  if (
    checkpoint.orphan_detected_at !== undefined &&
    typeof checkpoint.orphan_detected_at !== 'number'
  ) {
    return null;
  }

  if (
    checkpoint.recovery_candidate !== undefined &&
    typeof checkpoint.recovery_candidate !== 'boolean'
  ) {
    return null;
  }

  if (
    checkpoint.recovery_candidate_marked_at !== undefined &&
    typeof checkpoint.recovery_candidate_marked_at !== 'number'
  ) {
    return null;
  }

  if (
    checkpoint.recovery_candidate_reason !== undefined &&
    checkpoint.recovery_candidate_reason !== 'manual_operator_mark'
  ) {
    return null;
  }

  if (
    checkpoint.replay_candidate !== undefined &&
    typeof checkpoint.replay_candidate !== 'boolean'
  ) {
    return null;
  }

  if (
    checkpoint.replay_candidate_marked_at !== undefined &&
    typeof checkpoint.replay_candidate_marked_at !== 'number'
  ) {
    return null;
  }

  if (
    checkpoint.replay_candidate_reason !== undefined &&
    checkpoint.replay_candidate_reason !== 'manual_operator_mark'
  ) {
    return null;
  }

  return checkpoint as EventedDispatchCheckpoint;
}
