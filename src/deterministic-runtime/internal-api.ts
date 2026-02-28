import type { Run, WorkItem } from '../work-order/types/index.js';
import type { CompileResult, PlanV1 } from './plan-compiler.js';

export type InternalRunEventType =
  | 'PLAN_COMPILE_REQUESTED'
  | 'PLAN_COMPILE_COMPLETED'
  | 'PLAN_COMPILE_FAILED'
  | 'RUN_CREATED'
  | 'RUN_LINKED'
  | 'REPLAY_REEXECUTION_REQUESTED'
  | 'REPLAY_REEXECUTION_STEP_EXECUTED'
  | 'REPLAY_REEXECUTION_STEP_SKIPPED'
  | 'REPLAY_REEXECUTION_COMPLETED';

export interface InternalRunEvent {
  event_id: string;
  sequence?: number;
  run_id: string;
  plan_id?: string;
  event_type: InternalRunEventType;
  ts_ms: number;
  payload: Record<string, unknown>;
}

export interface InternalRuntimeConfigResponse {
  deterministicRuntimeEnabled: boolean;
  planCompilerEnabled: boolean;
  toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  runtimeRollout: {
    shadowModeEnabled: boolean;
    canaryPercent: number;
    rollbackOnFailure: boolean;
    lanePercents: {
      dryRun: number;
      compile: number;
      replay: number;
    };
  };
}

export interface InternalPlanGetParams {
  goalId: string;
}

export type InternalPlanGetResponse = PlanV1;

export type InternalPlanGenerateParams = InternalPlanGetParams;

export interface InternalPlanCompileParams {
  plan: unknown;
  runtimeProfile?: unknown;
}

export type InternalPlanCompileResponse = CompileResult & {
  compile_run_id: string;
};

export interface InternalRunCreateParams {
  planId: string;
  acceptedPlan: unknown;
  compileRunId?: string;
}

export interface InternalRunCreateResponse {
  run_id: string;
  plan_id: string;
  status: 'created';
}

export interface InternalRunGetParams {
  runId: string;
}

export type InternalRunGetResponse = Run;

export interface InternalRunsByWorkItemParams {
  workItemId: string;
}

export interface InternalRunsByWorkItemResponse {
  workItem: WorkItem;
  runs: Run[];
}

export interface InternalRunEventsParams {
  runId: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  eventTypes?: InternalRunEventType[];
  relatedRunId?: string;
}

export interface InternalRunEventsResponse {
  runId: string;
  offset: number;
  cursor?: string;
  returned: number;
  nextOffset?: number;
  nextCursor?: string;
  events: InternalRunEvent[];
}

export interface InternalRunEventsPruneParams {
  beforeTsMs: number;
  runId?: string;
  runIds?: string[];
  eventTypes?: InternalRunEventType[];
  keepLatestPerRun?: number;
}

export interface InternalRunEventsPruneResponse {
  deleted: number;
}

export interface InternalRunsTimelineParams {
  runId: string;
  relatedRunId?: string;
}

export interface InternalRunTimelinePhase {
  phase: 'compile_requested' | 'compile_completed' | 'compile_failed' | 'run_created' | 'run_linked';
  ts_ms: number;
  run_id: string;
  event_type: InternalRunEventType;
  payload: Record<string, unknown>;
}

export interface InternalRunsTimelineResponse {
  runId: string;
  relatedRunId?: string;
  status: 'in_progress' | 'failed' | 'completed' | 'unknown';
  phases: InternalRunTimelinePhase[];
}

export interface InternalRunReplayParams {
  runId: string;
  relatedRunId?: string;
  mode?: 'facts_only' | 'reexecute_tools';
  allowTools?: string[];
  maxAttempts?: number;
  enableExecution?: boolean;
  reexecutionIdempotencyKey?: string;
}

export interface InternalRunsReplayResponse {
  runId: string;
  relatedRunId?: string;
  mode: 'facts_only' | 'reexecute_tools';
  status: 'in_progress' | 'failed' | 'completed' | 'unknown';
  summary: {
    total_events: number;
    first_ts_ms?: number;
    last_ts_ms?: number;
    compile_run_id?: string;
    runtime_run_id?: string;
    event_counts: Partial<Record<InternalRunEventType, number>>;
    facts_count: number;
    artifacts_count: number;
  };
  indexes: {
    facts: Array<{
      key: string;
      value: unknown;
      run_id: string;
      event_type: InternalRunEventType;
      ts_ms: number;
      event_id: string;
    }>;
    artifacts: Array<{
      id: string;
      uri?: string;
      kind?: string;
      raw: unknown;
      run_id: string;
      event_type: InternalRunEventType;
      ts_ms: number;
      event_id: string;
    }>;
  };
  phases: InternalRunTimelinePhase[];
  reexecution?: {
    status: 'dry_run_only';
    attempted_steps: number;
    eligible_steps: number;
    executed_steps: number;
    skipped: Array<{
      tool: string;
      reason: 'execution_disabled' | 'not_allowlisted' | 'tool_not_found' | 'non_idempotent' | 'execution_failed';
    }>;
    message: string;
  };
}

export interface InternalRuntimeExecuteDryRunParams {
  goalId: string;
  runtimeProfile?: unknown;
  goalOverride?: {
    title?: string;
    description?: string;
    priority?: number;
    tags?: string[];
  };
  workItemOverrides?: Array<{
    id: string;
    title?: string;
    description?: string;
    priority?: number;
    dependencies?: string[];
    context?: Record<string, unknown>;
  }>;
}

export interface InternalRuntimeExecuteDryRunResponse {
  ok: boolean;
  goalId: string;
  basePlan: PlanV1;
  plan: PlanV1;
  diff: {
    hasOverrides: boolean;
    goalChanged: boolean;
    planIdChanged: boolean;
    changedStepIds: string[];
    changedStepCount: number;
    goalFieldChanges: Array<'title' | 'description' | 'priority' | 'tags'>;
    stepStructureChanges: {
      added: number;
      removed: number;
      modified: number;
    };
    toolRefChanges: number;
    argsChanges: number;
  };
  report: {
    summary: string;
    status: 'pass' | 'fail';
    kpi: {
      compileOk: boolean;
      planStepCount: number;
      changedStepCount: number;
      goalFieldChangeCount: number;
      replayEventCount: number;
      replayFactsCount: number;
      replayArtifactsCount: number;
    };
  };
  compile: InternalPlanCompileResponse;
  run?: InternalRunCreateResponse;
  replay: InternalRunsReplayResponse;
}

export interface InternalToolManifestValidateParams {
  requireManifest?: boolean;
}

export interface InternalToolManifestValidateResponse {
  valid: boolean;
  totalTools: number;
  manifestsValidated: number;
  issues: Array<{
    toolName: string;
    code: string;
    message: string;
    path?: string;
  }>;
}

export interface InternalApiSkeletonResponse<TPayload> {
  ok: true;
  phase: 'm0-skeleton';
  payload: TPayload;
}

export function createInternalApiSkeletonResponse<TPayload>(payload: TPayload): InternalApiSkeletonResponse<TPayload> {
  return {
    ok: true,
    phase: 'm0-skeleton',
    payload,
  };
}

export interface InternalApiSurface {
  'internal.runtime.config': {
    params: Record<string, never>;
    response: InternalRuntimeConfigResponse;
  };
  'internal.plan.get': {
    params: InternalPlanGetParams;
    response: InternalPlanGetResponse;
  };
  'internal.plan.compile': {
    params: InternalPlanCompileParams;
    response: InternalPlanCompileResponse;
  };
  'internal.run.create': {
    params: InternalRunCreateParams;
    response: InternalRunCreateResponse;
  };
  'internal.runs.events': {
    params: InternalRunEventsParams;
    response: InternalRunEventsResponse;
  };
  'internal.runs.events.prune': {
    params: InternalRunEventsPruneParams;
    response: InternalRunEventsPruneResponse;
  };
  'internal.runs.timeline': {
    params: InternalRunsTimelineParams;
    response: InternalRunsTimelineResponse;
  };
  'internal.runs.replay': {
    params: InternalRunReplayParams;
    response: InternalRunsReplayResponse;
  };
  'internal.runtime.executeDryRun': {
    params: InternalRuntimeExecuteDryRunParams;
    response: InternalRuntimeExecuteDryRunResponse;
  };
  'internal.run.get': {
    params: InternalRunGetParams;
    response: InternalRunGetResponse;
  };
  'internal.runs.byWorkItem': {
    params: InternalRunsByWorkItemParams;
    response: InternalRunsByWorkItemResponse;
  };
  'internal.toolManifest.validate': {
    params: InternalToolManifestValidateParams;
    response: InternalToolManifestValidateResponse;
  };
  'system.runtime.rollout.status': {
    params: Record<string, never>;
    response: unknown;
  };
  'system.runtime.rollout.update': {
    params: {
      shadowModeEnabled?: boolean;
      canaryPercent?: number;
      rollbackOnFailure?: boolean;
      rollbackToLegacy?: boolean;
    };
    response: unknown;
  };
}
