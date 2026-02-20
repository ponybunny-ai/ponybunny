import type { Goal, WorkItem, Run, Artifact, Decision, Escalation, ContextPack } from '../../domain/types.js';

export interface IWorkOrderRepository {
  initialize(): Promise<void>;
  close(): void;
  
  createGoal(params: CreateGoalParams): Goal;
  getGoal(id: string): Goal | undefined;
  updateGoalStatus(id: string, status: Goal['status']): void;
  listGoals(filters?: GoalFilters): Goal[];
  
  createWorkItem(params: CreateWorkItemParams): WorkItem;
  getWorkItem(id: string): WorkItem | undefined;
  updateWorkItemStatus(id: string, status: WorkItem['status']): void;
  getReadyWorkItems(goalId?: string): WorkItem[];
  getWorkItemsByGoal(goalId: string): WorkItem[];
  
  createRun(params: CreateRunParams): Run;
  getRun(id: string): Run | undefined;
  completeRun(id: string, params: CompleteRunParams): void;
  getRunsByWorkItem(workItemId: string): Run[];
  
  updateGoalSpending(goalId: string, tokens: number, timeMinutes: number, costUsd: number): void;
  incrementWorkItemRetry(workItemId: string): void;
  updateWorkItemStatusIfDependenciesMet(workItemId: string): void;
  getBlockedWorkItems(completedItemId: string): WorkItem[];
  getRepeatedErrorSignatures(workItemId: string, threshold: number): string[];
  
  createArtifact(params: CreateArtifactParams): Artifact;
  createDecision(params: CreateDecisionParams): Decision;
  createEscalation(params: CreateEscalationParams): Escalation;
  createContextPack(params: CreateContextPackParams): ContextPack;

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
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
}

export interface GoalFilters {
  status?: Goal['status'];
  parent_goal_id?: string | null;
}

export interface CreateWorkItemParams {
  goal_id: string;
  title: string;
  description: string;
  item_type: WorkItem['item_type'];
  priority?: number;
  dependencies?: string[];
  verification_plan?: WorkItem['verification_plan'];
}

export interface CreateRunParams {
  work_item_id: string;
  goal_id: string;
  agent_type: string;
  run_sequence: number;
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
