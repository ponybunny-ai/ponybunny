import type {
  Goal,
  WorkItem,
  Run,
  Artifact,
  Decision,
  Escalation,
  ContextPack,
  InFlightRunReconciliationCandidate,
} from '../../domain/types.js';
import type { DeterministicRunEvent, DeterministicRunEventType } from '../../deterministic-runtime/run-events.js';
import type Database from 'better-sqlite3';

export interface IWorkOrderRepository {
  initialize(): Promise<void>;
  close(): void;
  getDatabase(): Database.Database;
  
  createGoal(params: CreateGoalParams): Goal;
  getGoal(id: string): Goal | undefined;
  updateGoalStatus(id: string, status: Goal['status']): void;
  deleteGoal(id: string): void;
  listGoals(filters?: GoalFilters): Goal[];
  
  createWorkItem(params: CreateWorkItemParams): WorkItem;
  getWorkItem(id: string): WorkItem | undefined;
  updateWorkItemStatus(id: string, status: WorkItem['status']): void;
  getReadyWorkItems(goalId?: string): WorkItem[];
  getWorkItemsByGoal(goalId: string): WorkItem[];
  
  createRun(params: CreateRunParams): Run;
  getRun(id: string): Run | undefined;
  getRunInspection(id: string): RunInspectionRecord | undefined;
  precheckEventedManualReplay(id: string): EventedManualReplayPrecheckResult;
  mergeRunContext(id: string, contextPatch: Record<string, unknown>): void;
  claimEventedResultContinuation(id: string, appliedAt?: number): EventedResultContinuationClaim;
  startEventedManualReplay(
    id: string,
    params?: StartEventedManualReplayParams
  ): EventedManualReplayStartResult;
  markEventedRunOrphaned(
    id: string,
    params: MarkEventedRunOrphanedParams
  ): EventedRunOrphanMarkResult;
  markEventedRunRecoveryCandidate(
    id: string,
    params?: MarkEventedRunRecoveryCandidateParams
  ): EventedRunRecoveryCandidateMarkResult;
  markEventedRunReplayCandidate(
    id: string,
    params?: MarkEventedRunReplayCandidateParams
  ): EventedRunReplayCandidateMarkResult;
  clearEventedRunRecoveryCandidate(id: string): EventedRunRecoveryCandidateClearResult;
  completeRun(id: string, params: CompleteRunParams): void;
  getRunsByWorkItem(workItemId: string): Run[];
  listInFlightRunReconciliationCandidates(): InFlightRunReconciliationCandidate[];
  listEventedInFlightRunInspections(): EventedRunInspectionRecord[];
  listEventedOrphanedRunInspections(): EventedRunInspectionRecord[];
  getEventedRunReconciliationSummary(): EventedRunReconciliationSummary;

  appendRunEvent?(event: {
    run_id: string;
    plan_id?: string;
    event_type: DeterministicRunEventType;
    payload: Record<string, unknown>;
    ts_ms?: number;
    event_id?: string;
  }): DeterministicRunEvent;
  listRunEvents?(params: {
    run_id?: string;
    run_ids?: string[];
    event_types?: DeterministicRunEventType[];
    limit?: number;
    offset?: number;
  }): DeterministicRunEvent[];
  pruneRunEvents?(params: {
    before_ts_ms: number;
    run_id?: string;
    run_ids?: string[];
    event_types?: DeterministicRunEventType[];
    keep_latest_per_run?: number;
  }): {
    deleted: number;
  };
  
  updateGoalSpending(goalId: string, tokens: number, timeMinutes: number, costUsd: number): void;
  incrementWorkItemRetry(workItemId: string): void;
  updateWorkItemStatusIfDependenciesMet(workItemId: string): void;
  getBlockedWorkItems(completedItemId: string): WorkItem[];
  getRepeatedErrorSignatures(workItemId: string, threshold: number): string[];
  
  createArtifact(params: CreateArtifactParams): Artifact;
  createDecision(params: CreateDecisionParams): Decision;
  createEscalation(params: CreateEscalationParams): Escalation;
  createContextPack(params: CreateContextPackParams): ContextPack;
  getLatestContextPack(goal_id: string, pack_type?: ContextPack['pack_type']): ContextPack | undefined;

  upsertCronJob(params: UpsertCronJobParams): CronJob;
  getCronJob(agent_id: string): CronJob | undefined;
  listCronJobs(): CronJob[];
  claimDueCronJobs(params: ClaimDueCronJobsParams): CronJob[];
  markCronJobInFlight(params: MarkCronJobInFlightParams): void;
  updateCronJobAfterOutcome(params: UpdateCronJobAfterOutcomeParams): void;
  getOrCreateCronJobRun(params: CreateCronJobRunParams): CronJobRun;
  linkCronJobRunToGoal(run_key: string, goal_id: string): void;
  updateCronJobRunStatus(run_key: string, status: CronJobRunStatus): void;
}

export interface CreateGoalParams {
  title: string;
  description: string;
  success_criteria: Goal['success_criteria'];
  priority?: number;
  allowed_actions?: Goal['allowed_actions'];
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
  context?: Goal['context'];
}

export interface GoalFilters {
  status?: Goal['status'];
  parent_goal_id?: string | null;
  session_id?: string;
  turn_id?: string;
}

export interface CreateWorkItemParams {
  goal_id: string;
  title: string;
  description: string;
  item_type: WorkItem['item_type'];
  priority?: number;
  dependencies?: string[];
  verification_plan?: WorkItem['verification_plan'];
  context?: WorkItem['context'];
}

export interface CreateRunParams {
  work_item_id: string;
  goal_id: string;
  agent_type: string;
  run_sequence: number;
  context?: Record<string, unknown>;
}

export interface CompleteRunParams {
  status: 'success' | 'failure' | 'timeout' | 'aborted';
  exit_code?: number;
  error_message?: string;
  tokens_used: number;
  time_seconds: number;
  cost_usd: number;
  artifacts: string[];
  execution_log?: string;
  context?: Record<string, unknown>;
}

export type EventedResultContinuationClaimStatus =
  | 'claimed'
  | 'already_applied'
  | 'suppressed_by_replay'
  | 'already_terminal'
  | 'missing_evented_dispatch'
  | 'run_not_found';

export interface EventedResultContinuationClaim {
  status: EventedResultContinuationClaimStatus;
  appliedAt?: number;
  run?: Run;
}

export interface MarkEventedRunOrphanedParams {
  classification: 'stale_timeout';
  detectedAt?: number;
}

export type EventedRunOrphanMarkStatus =
  | 'marked'
  | 'already_marked'
  | 'already_applied'
  | 'already_terminal'
  | 'missing_evented_dispatch'
  | 'run_not_found';

export interface EventedRunOrphanMarkResult {
  status: EventedRunOrphanMarkStatus;
  detectedAt?: number;
  run?: Run;
}

export interface EventedRunInspectionRecord {
  run: Run;
  workItemStatus: WorkItem['status'];
  workItemUpdatedAt: number;
  executionMode: 'evented';
  laneId?: string;
  dispatchedAt?: number;
  resultContinuationApplied: boolean;
  resultContinuationAppliedAt?: number;
  orphanClassification?: string;
  orphanDetectedAt?: number;
  recoveryCandidate?: boolean;
  recoveryCandidateMarkedAt?: number;
  recoveryCandidateReason?: string;
  replayCandidate?: boolean;
  replayCandidateMarkedAt?: number;
  replayCandidateReason?: string;
  replayReplacementRunId?: string;
  replayRequestedAt?: number;
  replaySuppressedAt?: number;
  replayOfRunId?: string;
  replayStartedAt?: number;
}

export interface RunInspectionRecord {
  run: Run;
  workItemStatus: WorkItem['status'];
  workItemUpdatedAt: number;
  executionMode: 'direct' | 'evented';
  laneId?: string;
  dispatchedAt?: number;
  resultContinuationApplied: boolean;
  resultContinuationAppliedAt?: number;
  orphanClassification?: string;
  orphanDetectedAt?: number;
  recoveryCandidate?: boolean;
  recoveryCandidateMarkedAt?: number;
  recoveryCandidateReason?: string;
  replayCandidate?: boolean;
  replayCandidateMarkedAt?: number;
  replayCandidateReason?: string;
  replayReplacementRunId?: string;
  replayRequestedAt?: number;
  replaySuppressedAt?: number;
  replayOfRunId?: string;
  replayStartedAt?: number;
}

export interface EventedRunReconciliationSummary {
  inFlightEvented: number;
  staleOrphaned: number;
  continuationApplied: number;
  alreadyTerminal: number;
}

export interface CreateArtifactParams {
  run_id: string;
  work_item_id: string;
  goal_id: string;
  artifact_type: Artifact['artifact_type'];
  content_hash: string;
  size_bytes: number;
  storage_type: Artifact['storage_type'];
  file_path?: string;
  content?: string;
  blob_path?: string;
}

export interface MarkEventedRunRecoveryCandidateParams {
  markedAt?: number;
  reason?: 'manual_operator_mark';
}

export interface StartEventedManualReplayParams {
  requestedAt?: number;
  requestedReason?: 'manual_operator_request';
}

export type EventedManualReplayStartStatus =
  | 'replay_started'
  | 'run_not_found'
  | 'missing_evented_dispatch'
  | 'already_applied'
  | 'already_terminal'
  | 'work_item_not_in_progress'
  | 'recovery_candidate_required'
  | 'replay_candidate_required'
  | 'missing_orphan_classification'
  | 'already_replayed'
  | 'replay_attempt_not_allowed';

export interface EventedManualReplayStartResult {
  status: EventedManualReplayStartStatus;
  requestedAt?: number;
  requestedReason?: 'manual_operator_request';
  originalRun?: Run;
  replacementRun?: Run;
}

export type EventedManualReplayPrecheckStatus =
  | 'eligible'
  | 'run_not_found'
  | 'missing_evented_dispatch'
  | 'already_applied'
  | 'already_terminal'
  | 'work_item_not_in_progress'
  | 'recovery_candidate_required'
  | 'replay_candidate_required'
  | 'missing_orphan_classification'
  | 'already_replayed'
  | 'replay_attempt_not_allowed';

export interface EventedManualReplayPrecheckResult {
  status: EventedManualReplayPrecheckStatus;
  eligible: boolean;
  rejectionReasons: Exclude<EventedManualReplayPrecheckStatus, 'eligible'>[];
  expectedConsequences: string[];
  originalRun?: Run;
}

export type EventedRunRecoveryCandidateMarkStatus =
  | 'marked'
  | 'already_marked'
  | 'already_applied'
  | 'already_terminal'
  | 'missing_evented_dispatch'
  | 'run_not_found';

export interface EventedRunRecoveryCandidateMarkResult {
  status: EventedRunRecoveryCandidateMarkStatus;
  markedAt?: number;
  reason?: 'manual_operator_mark';
  run?: Run;
}

export interface MarkEventedRunReplayCandidateParams {
  markedAt?: number;
  reason?: 'manual_operator_mark';
}

export type EventedRunReplayCandidateMarkStatus =
  | 'marked'
  | 'already_marked'
  | 'recovery_candidate_required'
  | 'already_applied'
  | 'already_terminal'
  | 'missing_evented_dispatch'
  | 'run_not_found';

export interface EventedRunReplayCandidateMarkResult {
  status: EventedRunReplayCandidateMarkStatus;
  markedAt?: number;
  reason?: 'manual_operator_mark';
  run?: Run;
}

export type EventedRunRecoveryCandidateClearStatus =
  | 'cleared'
  | 'already_cleared'
  | 'not_marked'
  | 'missing_evented_dispatch'
  | 'run_not_found';

export interface EventedRunRecoveryCandidateClearResult {
  status: EventedRunRecoveryCandidateClearStatus;
  run?: Run;
}

export interface CreateDecisionParams {
  run_id: string;
  work_item_id: string;
  goal_id: string;
  decision_type: Decision['decision_type'];
  decision_point: string;
  options_considered: Decision['options_considered'];
  selected_option: string;
  reasoning: string;
  confidence_score?: number;
  metadata?: Record<string, any>;
}

export interface CreateEscalationParams {
  work_item_id: string;
  goal_id: string;
  run_id?: string;
  escalation_type: Escalation['escalation_type'];
  severity: Escalation['severity'];
  title: string;
  description: string;
}

export interface CreateContextPackParams {
  goal_id: string;
  pack_type: ContextPack['pack_type'];
  snapshot_data: ContextPack['snapshot_data'];
  compressed?: boolean;
}

export type CronJobRunStatus = 'pending' | 'claimed' | 'submitted' | 'running' | 'success' | 'failure';

export interface CronJobScheduleInput {
  kind: 'cron' | 'interval';
  cron?: string;
  every_ms?: number;
  tz?: string;
}

export interface CronJob {
  agent_id: string;
  enabled: boolean;
  schedule_cron?: string;
  schedule_timezone?: string;
  schedule_interval_ms?: number;
  next_run_at_ms?: number;
  last_run_at_ms?: number;
  in_flight_run_key?: string;
  in_flight_goal_id?: string;
  in_flight_started_at_ms?: number;
  claimed_at_ms?: number;
  claimed_by?: string;
  claim_expires_at_ms?: number;
  definition_hash: string;
  backoff_until_ms?: number;
  failure_count: number;
}

export interface CronJobRun {
  run_key: string;
  agent_id: string;
  scheduled_for_ms: number;
  created_at_ms: number;
  goal_id?: string;
  status: CronJobRunStatus;
}

export interface UpsertCronJobParams {
  agent_id: string;
  enabled: boolean;
  schedule: CronJobScheduleInput;
  definition_hash: string;
  now_ms?: number;
}

export interface ClaimDueCronJobsParams {
  now_ms: number;
  claim_ttl_ms: number;
  claimed_by: string;
  limit?: number;
}

export interface MarkCronJobInFlightParams {
  agent_id: string;
  run_key: string;
  goal_id?: string;
  started_at_ms: number;
  last_run_at_ms: number;
}

export interface UpdateCronJobAfterOutcomeParams {
  agent_id: string;
  next_run_at_ms: number | null;
  backoff_until_ms?: number | null;
  failure_count?: number;
}

export interface CreateCronJobRunParams {
  agent_id: string;
  scheduled_for_ms: number;
  created_at_ms: number;
  status: CronJobRunStatus;
  goal_id?: string;
}
