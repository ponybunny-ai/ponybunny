import type {
  EventedStartupReconciliationClassification,
  EventedStartupReconciliationFinding,
  EventedStartupReconciliationSummary,
} from '../scheduler/evented-dispatch-checkpoint.js';
import type { InFlightRunReconciliationCandidate } from '../work-order/types/index.js';
import { readEventedDispatchCheckpoint } from '../scheduler/evented-dispatch-checkpoint.js';

const DEFAULT_REATTACHABLE_WINDOW_MS = 30_000;

export function classifyEventedStartupCandidate(
  candidate: InFlightRunReconciliationCandidate,
  nowMs: number,
  reattachableWindowMs = DEFAULT_REATTACHABLE_WINDOW_MS
): EventedStartupReconciliationFinding {
  const checkpoint = readEventedDispatchCheckpoint(candidate.run.context);

  if (!checkpoint) {
    return buildFinding(candidate, 'not_evented_candidate', 'run has no durable evented dispatch checkpoint');
  }

  if (candidate.run.status !== 'running') {
    return buildFinding(candidate, 'already_terminal_in_db', 'run is already terminal in durable state');
  }

  if (checkpoint.result_continuation_applied) {
    return buildFinding(
      candidate,
      'already_terminal_in_db',
      'evented result continuation was already recorded on the run'
    );
  }

  if (
    candidate.workItemStatus === 'verify' ||
    candidate.workItemStatus === 'done' ||
    candidate.workItemStatus === 'failed' ||
    candidate.workItemStatus === 'blocked'
  ) {
    return buildFinding(
      candidate,
      'already_terminal_in_db',
      `work item is already beyond execution (${candidate.workItemStatus})`
    );
  }

  if (candidate.workItemStatus !== 'in_progress') {
    return buildFinding(
      candidate,
      'likely_orphaned',
      `work item is in unexpected durable state for an evented dispatch (${candidate.workItemStatus})`
    );
  }

  const ageMs = nowMs - checkpoint.dispatched_at;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs <= reattachableWindowMs) {
    return buildFinding(
      candidate,
      'maybe_reattachable',
      `evented dispatch is recent (${Math.max(ageMs, 0)}ms old)`
    );
  }

  return buildFinding(
    candidate,
    'likely_orphaned',
    `evented dispatch has been in flight for ${ageMs}ms without durable continuation`
  );
}

export function reconcileEventedStartupCandidates(
  candidates: InFlightRunReconciliationCandidate[],
  nowMs: number,
  reattachableWindowMs = DEFAULT_REATTACHABLE_WINDOW_MS
): EventedStartupReconciliationSummary {
  const findings = candidates.map((candidate) =>
    classifyEventedStartupCandidate(candidate, nowMs, reattachableWindowMs)
  );

  const byClassification: Record<EventedStartupReconciliationClassification, number> = {
    not_evented_candidate: 0,
    already_terminal_in_db: 0,
    maybe_reattachable: 0,
    likely_orphaned: 0,
  };

  for (const finding of findings) {
    byClassification[finding.classification]++;
  }

  return {
    startedAt: nowMs,
    scanned: candidates.length,
    byClassification,
    findings,
  };
}

function buildFinding(
  candidate: InFlightRunReconciliationCandidate,
  classification: EventedStartupReconciliationClassification,
  reason: string
): EventedStartupReconciliationFinding {
  const checkpoint = readEventedDispatchCheckpoint(candidate.run.context);

  return {
    runId: candidate.run.id,
    goalId: candidate.run.goal_id,
    workItemId: candidate.run.work_item_id,
    workItemStatus: candidate.workItemStatus,
    laneId: checkpoint?.lane_id,
    dispatchedAt: checkpoint?.dispatched_at,
    classification,
    reason,
  };
}
