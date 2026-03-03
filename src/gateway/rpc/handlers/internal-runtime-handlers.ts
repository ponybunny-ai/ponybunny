import type { RpcHandler } from '../rpc-handler.js';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { Goal, Run, SuccessCriterion, WorkItem } from '../../../work-order/types/index.js';
import { ToolAllowlist, ToolEnforcer, type ToolRegistry } from '../../../infra/tools/tool-registry.js';
import { GatewayError, ErrorCodes } from '../../errors.js';
import { ToolManifestValidator } from '../../../deterministic-runtime/tool-manifest-validator.js';
import { PlanCompiler, type CompileResult, type PlanV1 } from '../../../deterministic-runtime/plan-compiler.js';
import {
  InMemoryDeterministicRunEventStore,
  RepositoryBackedDeterministicRunEventStore,
  type DeterministicRunEventType,
  type DeterministicRunEvent,
  type DeterministicRunEventStore,
} from '../../../deterministic-runtime/run-events.js';

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
  tui: {
    inputBackgroundColor: 'gray' | 'black' | 'blue' | 'green' | 'yellow' | 'magenta' | 'cyan' | 'white';
    sessionFirstEnabled: boolean;
    goalSubmitFastPathEnabled: boolean;
  };
}

export interface InternalRuntimeHandlersOptions {
  onDryRunComplete?: (sample: {
    ok: boolean;
    planStepCount: number;
    changedStepCount: number;
    compileErrorCodes: string[];
    timestamp: number;
  }) => void;
}

export interface InternalPlanGetParams {
  goalId: string;
}

export interface InternalPlanCompileParams {
  plan: unknown;
  runtimeProfile?: unknown;
}

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

export interface InternalRunsByWorkItemParams {
  workItemId: string;
}

export type InternalPlanGetResponse = PlanV1;

export type InternalPlanCompileResponse = CompileResult & {
  compile_run_id: string;
};

export interface InternalRunsByWorkItemResponse {
  workItem: WorkItem;
  runs: Run[];
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

export interface InternalRunEventsParams {
  runId: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  eventTypes?: DeterministicRunEventType[];
  relatedRunId?: string;
}

export interface InternalRunEventsResponse {
  runId: string;
  offset: number;
  cursor?: string;
  returned: number;
  nextOffset?: number;
  nextCursor?: string;
  events: DeterministicRunEvent[];
}

export interface InternalRunEventsPruneParams {
  beforeTsMs: number;
  runId?: string;
  runIds?: string[];
  eventTypes?: DeterministicRunEventType[];
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
  phase:
    | 'compile_requested'
    | 'compile_completed'
    | 'compile_failed'
    | 'run_created'
    | 'run_linked'
    | 'replay_reexecution_requested'
    | 'replay_reexecution_step_executed'
    | 'replay_reexecution_step_skipped'
    | 'replay_reexecution_completed';
  ts_ms: number;
  run_id: string;
  event_type: DeterministicRunEventType;
  payload: Record<string, unknown>;
}

export interface InternalRunsTimelineResponse {
  runId: string;
  relatedRunId?: string;
  status: 'in_progress' | 'failed' | 'completed' | 'unknown';
  phases: InternalRunTimelinePhase[];
}

export interface InternalRunsReplayParams {
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
    event_counts: Partial<Record<DeterministicRunEventType, number>>;
    facts_count: number;
    artifacts_count: number;
  };
  indexes: {
    facts: Array<{
      key: string;
      value: unknown;
      run_id: string;
      event_type: DeterministicRunEventType;
      ts_ms: number;
      event_id: string;
    }>;
    artifacts: Array<{
      id: string;
      uri?: string;
      kind?: string;
      raw: unknown;
      run_id: string;
      event_type: DeterministicRunEventType;
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

function computePlanDiff(basePlan: PlanV1, currentPlan: PlanV1): InternalRuntimeExecuteDryRunResponse['diff'] {
  const baseGoal = basePlan.goal;
  const currentGoal = currentPlan.goal;
  const goalChanged = baseGoal !== currentGoal;
  const planIdChanged = basePlan.plan_id !== currentPlan.plan_id;

  const baseStepMap = new Map(basePlan.steps.map((step) => [step.id, JSON.stringify(step)]));
  const currentStepMap = new Map(currentPlan.steps.map((step) => [step.id, JSON.stringify(step)]));

  const stepIds = new Set<string>([...baseStepMap.keys(), ...currentStepMap.keys()]);
  const changedStepIds = [...stepIds]
    .filter((stepId) => baseStepMap.get(stepId) !== currentStepMap.get(stepId))
    .sort((a, b) => a.localeCompare(b));

  const baseGoalPayload = parseGoalPayload(baseGoal);
  const currentGoalPayload = parseGoalPayload(currentGoal);
  const goalFieldChanges: Array<'title' | 'description' | 'priority' | 'tags'> = [];
  if (baseGoalPayload.title !== currentGoalPayload.title) {
    goalFieldChanges.push('title');
  }
  if (baseGoalPayload.description !== currentGoalPayload.description) {
    goalFieldChanges.push('description');
  }
  if (baseGoalPayload.priority !== currentGoalPayload.priority) {
    goalFieldChanges.push('priority');
  }
  if (JSON.stringify(baseGoalPayload.tags) !== JSON.stringify(currentGoalPayload.tags)) {
    goalFieldChanges.push('tags');
  }

  let added = 0;
  let removed = 0;
  let modified = 0;
  let toolRefChanges = 0;
  let argsChanges = 0;

  const baseStepsById = new Map(basePlan.steps.map((step) => [step.id, step]));
  const currentStepsById = new Map(currentPlan.steps.map((step) => [step.id, step]));
  for (const stepId of stepIds) {
    const baseStep = baseStepsById.get(stepId);
    const currentStep = currentStepsById.get(stepId);

    if (!baseStep && currentStep) {
      added += 1;
      continue;
    }

    if (baseStep && !currentStep) {
      removed += 1;
      continue;
    }

    if (baseStep && currentStep) {
      if (JSON.stringify(baseStep) !== JSON.stringify(currentStep)) {
        modified += 1;
      }

      if ((baseStep.tool_ref ?? null) !== (currentStep.tool_ref ?? null)) {
        toolRefChanges += 1;
      }

      if (JSON.stringify(baseStep.args ?? null) !== JSON.stringify(currentStep.args ?? null)) {
        argsChanges += 1;
      }
    }
  }

  return {
    hasOverrides: goalChanged || planIdChanged || changedStepIds.length > 0,
    goalChanged,
    planIdChanged,
    changedStepIds,
    changedStepCount: changedStepIds.length,
    goalFieldChanges,
    stepStructureChanges: {
      added,
      removed,
      modified,
    },
    toolRefChanges,
    argsChanges,
  };
}

function buildDryRunReport(
  compileOk: boolean,
  currentPlan: PlanV1,
  diff: InternalRuntimeExecuteDryRunResponse['diff'],
  replay: InternalRunsReplayResponse
): InternalRuntimeExecuteDryRunResponse['report'] {
  const status: 'pass' | 'fail' = compileOk ? 'pass' : 'fail';
  const summary = compileOk
    ? `dryRun passed: ${currentPlan.steps.length} steps, ${diff.changedStepCount} step changes, ${replay.summary.total_events} replay events`
    : `dryRun failed: compile errors=${replay.summary.event_counts.PLAN_COMPILE_FAILED ?? 0}, replay events=${replay.summary.total_events}`;

  return {
    summary,
    status,
    kpi: {
      compileOk,
      planStepCount: currentPlan.steps.length,
      changedStepCount: diff.changedStepCount,
      goalFieldChangeCount: diff.goalFieldChanges.length,
      replayEventCount: replay.summary.total_events,
      replayFactsCount: replay.summary.facts_count,
      replayArtifactsCount: replay.summary.artifacts_count,
    },
  };
}

function parseGoalPayload(goal: string): {
  title?: string;
  description?: string;
  priority?: number;
  tags?: unknown;
} {
  try {
    const parsed = JSON.parse(goal) as {
      title?: string;
      description?: string;
      priority?: number;
      tags?: unknown;
    };
    return parsed;
  } catch {
    return {
      title: goal,
      description: undefined,
      priority: undefined,
      tags: undefined,
    };
  }
}

function buildPlanProjection(goal: Goal, workItems: WorkItem[]): PlanV1 {
  const orderedWorkItems = [...workItems].sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }

    if (a.created_at !== b.created_at) {
      return a.created_at - b.created_at;
    }

    return a.id.localeCompare(b.id);
  });

  const workItemIds = new Set(orderedWorkItems.map((item) => item.id));
  const stepById = new Map(orderedWorkItems.map((item) => [item.id, item]));

  const steps = orderedWorkItems.map((item) => {
    const validDependencies = (item.dependencies ?? [])
      .filter((depId) => workItemIds.has(depId) && depId !== item.id)
      .sort((a, b) => a.localeCompare(b));

    const step: PlanV1['steps'][number] = {
      id: item.id,
      type: 'transform',
    };

    if (validDependencies.length > 0) {
      step.depends_on = validDependencies;
    }

    const itemContext = stepById.get(item.id)?.context;
    if (itemContext && typeof itemContext === 'object') {
      const contextObject = itemContext as Record<string, unknown>;
      if (contextObject.planStep && typeof contextObject.planStep === 'object') {
        const planStep = contextObject.planStep as Record<string, unknown>;
        if (planStep.type === 'tool_call' && typeof planStep.tool_ref === 'string' && planStep.args && typeof planStep.args === 'object') {
          step.type = 'tool_call';
          step.tool_ref = planStep.tool_ref;
          step.args = planStep.args as Record<string, unknown>;
        }
      }
    }

    return step;
  });

  const serializedGoal = serializeGoalForPlan(goal);

  return {
    schema_version: 'plan.v1',
    plan_id: buildDeterministicPlanId(goal.id, serializedGoal, steps),
    goal: serializedGoal,
    steps,
  };
}

function buildDeterministicPlanId(goalId: string, serializedGoal: string, steps: PlanV1['steps']): string {
  const canonical = JSON.stringify({
    goalId,
    goal: serializedGoal,
    steps,
  });

  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return `plan-${goalId}-${digest}`;
}

function toPositiveLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw GatewayError.invalidParams('limit must be a positive integer');
  }

  return limit;
}

function toNonNegativeOffset(offset: number | undefined): number {
  if (offset === undefined) {
    return 0;
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw GatewayError.invalidParams('offset must be a non-negative integer');
  }

  return offset;
}

function cursorToOffset(cursor: string | undefined): number | undefined {
  if (cursor === undefined) {
    return undefined;
  }

  if (cursor.trim().length === 0) {
    throw GatewayError.invalidParams('cursor must be a non-empty numeric string');
  }

  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw GatewayError.invalidParams('cursor must encode a non-negative integer offset');
  }

  return parsed;
}

function validateEventTypes(eventTypes: DeterministicRunEventType[] | undefined): DeterministicRunEventType[] | undefined {
  if (eventTypes === undefined) {
    return undefined;
  }

  if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
    throw GatewayError.invalidParams('eventTypes must be a non-empty array when provided');
  }

  const allowed: DeterministicRunEventType[] = [
    'PLAN_COMPILE_REQUESTED',
    'PLAN_COMPILE_COMPLETED',
    'PLAN_COMPILE_FAILED',
    'RUN_CREATED',
    'RUN_LINKED',
    'REPLAY_REEXECUTION_REQUESTED',
    'REPLAY_REEXECUTION_STEP_EXECUTED',
    'REPLAY_REEXECUTION_STEP_SKIPPED',
    'REPLAY_REEXECUTION_COMPLETED',
  ];

  const unique = Array.from(new Set(eventTypes));
  for (const eventType of unique) {
    if (!allowed.includes(eventType)) {
      throw GatewayError.invalidParams(`unsupported event type: ${eventType}`);
    }
  }

  return unique;
}

function toPruneBeforeTsMs(beforeTsMs: number | undefined): number {
  if (beforeTsMs === undefined || !Number.isInteger(beforeTsMs) || beforeTsMs < 0) {
    throw GatewayError.invalidParams('beforeTsMs must be a non-negative integer');
  }

  return beforeTsMs;
}

function toPruneKeepLatestPerRun(keepLatestPerRun: number | undefined): number {
  if (keepLatestPerRun === undefined) {
    return 0;
  }

  if (!Number.isInteger(keepLatestPerRun) || keepLatestPerRun < 0) {
    throw GatewayError.invalidParams('keepLatestPerRun must be a non-negative integer');
  }

  return keepLatestPerRun;
}

function normalizeRunIds(runId: string | undefined, runIds: string[] | undefined): {
  runId?: string;
  runIds?: string[];
} {
  if (runId !== undefined) {
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      throw GatewayError.invalidParams('runId must be a non-empty string when provided');
    }
  }

  if (runIds !== undefined) {
    if (!Array.isArray(runIds) || runIds.length === 0) {
      throw GatewayError.invalidParams('runIds must be a non-empty array when provided');
    }

    if (runIds.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
      throw GatewayError.invalidParams('runIds must contain only non-empty strings');
    }
  }

  const normalizedRunIds = runIds
    ? Array.from(new Set(runIds.map((entry) => entry.trim())))
    : undefined;

  return {
    runId: runId?.trim(),
    runIds: normalizedRunIds,
  };
}

function mergeRunEvents(
  repository: IWorkOrderRepository,
  eventStore: DeterministicRunEventStore,
  runId: string,
  relatedRunId?: string
): DeterministicRunEvent[] {
  if (repository.listRunEvents) {
    const runIds = relatedRunId ? [runId, relatedRunId] : [runId];
    const events = repository.listRunEvents({ run_ids: runIds });
    return [...events].sort((a, b) => {
      if (a.ts_ms !== b.ts_ms) {
        return a.ts_ms - b.ts_ms;
      }

      if (a.sequence !== undefined || b.sequence !== undefined) {
        return (a.sequence ?? 0) - (b.sequence ?? 0);
      }

      return a.event_id.localeCompare(b.event_id);
    });
  }

  const primaryEvents = eventStore.listByRunId(runId);
  const relatedEvents = relatedRunId ? eventStore.listByRunId(relatedRunId) : [];

  return [...primaryEvents, ...relatedEvents].sort((a, b) => {
    if (a.ts_ms !== b.ts_ms) {
      return a.ts_ms - b.ts_ms;
    }

    if (a.sequence !== undefined || b.sequence !== undefined) {
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    }

    return a.event_id.localeCompare(b.event_id);
  });
}

function sortEventsStable(events: DeterministicRunEvent[]): DeterministicRunEvent[] {
  return [...events].sort((a, b) => {
    if (a.ts_ms !== b.ts_ms) {
      return a.ts_ms - b.ts_ms;
    }

    if (a.sequence !== undefined || b.sequence !== undefined) {
      return (a.sequence ?? 0) - (b.sequence ?? 0);
    }

    return a.event_id.localeCompare(b.event_id);
  });
}

function eventTypeToPhase(eventType: DeterministicRunEventType): InternalRunTimelinePhase['phase'] {
  switch (eventType) {
    case 'PLAN_COMPILE_REQUESTED':
      return 'compile_requested';
    case 'PLAN_COMPILE_COMPLETED':
      return 'compile_completed';
    case 'PLAN_COMPILE_FAILED':
      return 'compile_failed';
    case 'RUN_CREATED':
      return 'run_created';
    case 'RUN_LINKED':
      return 'run_linked';
    case 'REPLAY_REEXECUTION_REQUESTED':
      return 'replay_reexecution_requested';
    case 'REPLAY_REEXECUTION_STEP_EXECUTED':
      return 'replay_reexecution_step_executed';
    case 'REPLAY_REEXECUTION_STEP_SKIPPED':
      return 'replay_reexecution_step_skipped';
    case 'REPLAY_REEXECUTION_COMPLETED':
      return 'replay_reexecution_completed';
  }
}

function deriveTimelineStatus(events: DeterministicRunEvent[]): InternalRunsTimelineResponse['status'] {
  const eventTypes = new Set(events.map((event) => event.event_type));
  if (eventTypes.has('PLAN_COMPILE_FAILED')) {
    return 'failed';
  }

  if (eventTypes.has('RUN_LINKED')) {
    return 'completed';
  }

  if (eventTypes.has('PLAN_COMPILE_REQUESTED') || eventTypes.has('PLAN_COMPILE_COMPLETED') || eventTypes.has('RUN_CREATED')) {
    return 'in_progress';
  }

  return 'unknown';
}

function toEventCounts(events: DeterministicRunEvent[]): Partial<Record<DeterministicRunEventType, number>> {
  const counts: Partial<Record<DeterministicRunEventType, number>> = {};
  for (const event of events) {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
  }
  return counts;
}

function extractFactsAndArtifacts(events: DeterministicRunEvent[]): InternalRunsReplayResponse['indexes'] {
  const facts: InternalRunsReplayResponse['indexes']['facts'] = [];
  const artifacts: InternalRunsReplayResponse['indexes']['artifacts'] = [];

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;

    const payloadFacts = payload.facts;
    if (payloadFacts && typeof payloadFacts === 'object' && !Array.isArray(payloadFacts)) {
      for (const [key, value] of Object.entries(payloadFacts as Record<string, unknown>)) {
        facts.push({
          key,
          value,
          run_id: event.run_id,
          event_type: event.event_type,
          ts_ms: event.ts_ms,
          event_id: event.event_id,
        });
      }
    }

    const payloadArtifacts = payload.artifacts;
    if (Array.isArray(payloadArtifacts)) {
      for (const artifact of payloadArtifacts) {
        const artifactObject = (artifact && typeof artifact === 'object') ? artifact as Record<string, unknown> : undefined;
        const artifactId = typeof artifactObject?.id === 'string' ? artifactObject.id : `artifact-${event.event_id}-${artifacts.length + 1}`;
        artifacts.push({
          id: artifactId,
          uri: typeof artifactObject?.uri === 'string' ? artifactObject.uri : undefined,
          kind: typeof artifactObject?.kind === 'string' ? artifactObject.kind : undefined,
          raw: artifact,
          run_id: event.run_id,
          event_type: event.event_type,
          ts_ms: event.ts_ms,
          event_id: event.event_id,
        });
      }
    }
  }

  return { facts, artifacts };
}

function toReplayAllowTools(value: unknown): Set<string> | null {
  if (value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw GatewayError.invalidParams('allowTools must be an array of tool names when provided');
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (normalized.length !== value.length) {
    throw GatewayError.invalidParams('allowTools must contain only non-empty strings');
  }

  return new Set(normalized);
}

function toReplayMaxAttempts(value: unknown): number {
  if (value === undefined) {
    return 20;
  }

  if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 200) {
    throw GatewayError.invalidParams('maxAttempts must be an integer between 1 and 200 when provided');
  }

  return value as number;
}

function toReplayEnableExecution(value: unknown): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== 'boolean') {
    throw GatewayError.invalidParams('enableExecution must be a boolean when provided');
  }

  return value;
}

function toReplayIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw GatewayError.invalidParams('reexecutionIdempotencyKey must be a non-empty string when provided');
  }

  return value.trim();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(',')}}`;
}

interface ReplayToolInvocation {
  tool: string;
  args: Record<string, unknown>;
}

function collectToolCandidatesFromPayload(payload: unknown, sink: ReplayToolInvocation[]): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      collectToolCandidatesFromPayload(item, sink);
    }
    return;
  }

  const record = payload as Record<string, unknown>;
  const directToolKeys = ['tool_ref', 'toolRef', 'tool_name', 'toolName'];
  let toolName: string | undefined;
  for (const key of directToolKeys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      toolName = value.trim();
      break;
    }
  }

  if (toolName) {
    const candidateArgs = (record.args && typeof record.args === 'object' && !Array.isArray(record.args))
      ? (record.args as Record<string, unknown>)
      : {};
    sink.push({ tool: toolName, args: { ...candidateArgs } });
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      collectToolCandidatesFromPayload(value, sink);
    }
  }
}

function extractReplayToolCandidates(events: DeterministicRunEvent[]): ReplayToolInvocation[] {
  const candidates: ReplayToolInvocation[] = [];
  for (const event of events) {
    collectToolCandidatesFromPayload(event.payload, candidates);
  }

  const deduped = new Map<string, ReplayToolInvocation>();
  for (const candidate of candidates) {
    const normalizedTool = normalizeReplayToolName(candidate.tool);
    const key = `${normalizedTool}:${stableStringify(candidate.args)}`;
    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  return Array.from(deduped.values());
}

function normalizeReplayToolName(toolName: string): string {
  if (toolName.startsWith('local://')) {
    return toolName.slice('local://'.length);
  }

  return toolName;
}

function serializeGoalForPlan(goal: Goal): string {
  const normalizedCriteria = [...(goal.success_criteria ?? [])]
    .map((criterion) => normalizeSuccessCriterion(criterion))
    .sort((a, b) => {
      const byDescription = a.description.localeCompare(b.description);
      if (byDescription !== 0) {
        return byDescription;
      }

      const byMethod = a.verification_method.localeCompare(b.verification_method);
      if (byMethod !== 0) {
        return byMethod;
      }

      const byType = a.type.localeCompare(b.type);
      if (byType !== 0) {
        return byType;
      }

      return Number(a.required) - Number(b.required);
    });

  const normalizedTags = [...(goal.tags ?? [])]
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const payload = {
    title: goal.title,
    description: goal.description,
    priority: goal.priority,
    success_criteria: normalizedCriteria,
    tags: normalizedTags,
  };

  return JSON.stringify(payload);
}

function normalizeSuccessCriterion(criterion: SuccessCriterion): SuccessCriterion {
  return {
    description: criterion.description,
    type: criterion.type,
    verification_method: criterion.verification_method,
    required: criterion.required,
  };
}

export function registerInternalRuntimeHandlers(
  rpcHandler: RpcHandler,
  repository: IWorkOrderRepository,
  getRuntimeConfig: () => InternalRuntimeConfigResponse,
  getToolRegistry?: () => ToolRegistry | undefined,
  runEventStore?: DeterministicRunEventStore,
  options?: InternalRuntimeHandlersOptions
): void {
  const eventStore = runEventStore
    ?? (repository.appendRunEvent && repository.listRunEvents
      ? new RepositoryBackedDeterministicRunEventStore(repository)
      : new InMemoryDeterministicRunEventStore());

  rpcHandler.register<Record<string, never>, InternalRuntimeConfigResponse>(
    'internal.runtime.config',
    ['admin'],
    async () => getRuntimeConfig()
  );

  rpcHandler.register<InternalPlanGetParams, InternalPlanGetResponse>(
    'internal.plan.get',
    ['admin'],
    async (params) => {
      if (!params.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const goal = repository.getGoal(params.goalId);
      if (!goal) {
        throw GatewayError.notFound('goal', params.goalId);
      }

      const workItems = repository.getWorkItemsByGoal(params.goalId);
      return buildPlanProjection(goal, workItems);
    }
  );

  const buildPlanForGoal = (goalId: string): PlanV1 => {
    const goal = repository.getGoal(goalId);
    if (!goal) {
      throw GatewayError.notFound('goal', goalId);
    }

    const workItems = repository.getWorkItemsByGoal(goalId);
    return buildPlanProjection(goal, workItems);
  };

  const buildPlanForGoalWithOverrides = (
    params: InternalRuntimeExecuteDryRunParams
  ): PlanV1 => {
    const goal = repository.getGoal(params.goalId);
    if (!goal) {
      throw GatewayError.notFound('goal', params.goalId);
    }

    const goalOverride = params.goalOverride;
    const mergedGoal: Goal = {
      ...goal,
      title: goalOverride?.title ?? goal.title,
      description: goalOverride?.description ?? goal.description,
      priority: goalOverride?.priority ?? goal.priority,
      tags: goalOverride?.tags ?? goal.tags,
    };

    if (goalOverride?.priority !== undefined && (!Number.isInteger(goalOverride.priority) || goalOverride.priority < 0)) {
      throw GatewayError.invalidParams('goalOverride.priority must be a non-negative integer');
    }

    if (goalOverride?.tags !== undefined && !Array.isArray(goalOverride.tags)) {
      throw GatewayError.invalidParams('goalOverride.tags must be an array of strings when provided');
    }

    if (goalOverride?.tags && goalOverride.tags.some((tag) => typeof tag !== 'string')) {
      throw GatewayError.invalidParams('goalOverride.tags must contain only strings');
    }

    const workItems = repository.getWorkItemsByGoal(params.goalId);
    const overrideMap = new Map((params.workItemOverrides ?? []).map((override) => [override.id, override]));

    for (const override of params.workItemOverrides ?? []) {
      if (!override.id || typeof override.id !== 'string') {
        throw GatewayError.invalidParams('each workItemOverride must include a valid id');
      }

      if (override.priority !== undefined && (!Number.isInteger(override.priority) || override.priority < 0)) {
        throw GatewayError.invalidParams('workItemOverride.priority must be a non-negative integer');
      }

      if (override.dependencies !== undefined) {
        if (!Array.isArray(override.dependencies) || override.dependencies.some((dep) => typeof dep !== 'string')) {
          throw GatewayError.invalidParams('workItemOverride.dependencies must be an array of strings when provided');
        }
      }
    }

    const mergedWorkItems = workItems.map((workItem) => {
      const override = overrideMap.get(workItem.id);
      if (!override) {
        return workItem;
      }

      const mergedContext = override.context
        ? { ...(workItem.context ?? {}), ...override.context }
        : workItem.context;

      return {
        ...workItem,
        title: override.title ?? workItem.title,
        description: override.description ?? workItem.description,
        priority: override.priority ?? workItem.priority,
        dependencies: override.dependencies ?? workItem.dependencies,
        context: mergedContext,
      };
    });

    return buildPlanProjection(mergedGoal, mergedWorkItems);
  };

  rpcHandler.register<InternalPlanCompileParams, InternalPlanCompileResponse>(
    'internal.plan.compile',
    ['admin'],
    async (params) => {
      if (!params || params.plan === undefined) {
        throw GatewayError.invalidParams('plan is required');
      }

      const toolRegistry = getToolRegistry?.();
      if (!toolRegistry) {
        throw GatewayError.internalError('tool registry is not available');
      }

      const compiler = new PlanCompiler(toolRegistry);
      const planCandidate = params.plan as { plan_id?: string };
      const planId = typeof planCandidate?.plan_id === 'string' ? planCandidate.plan_id : undefined;
      const runId = `compile-${planId ?? randomUUID()}`;

      eventStore.append({
        run_id: runId,
        plan_id: planId,
        event_type: 'PLAN_COMPILE_REQUESTED',
        payload: {
          has_runtime_profile: params.runtimeProfile !== undefined,
        },
      });

      const result = compiler.compile(params.plan, params.runtimeProfile);

      eventStore.append({
        run_id: runId,
        plan_id: result.acceptedPlan?.planId ?? planId,
        event_type: result.ok ? 'PLAN_COMPILE_COMPLETED' : 'PLAN_COMPILE_FAILED',
        payload: {
          ok: result.ok,
          error_count: result.errors.length,
        },
      });

      return {
        ...result,
        compile_run_id: runId,
      };
    }
  );

  rpcHandler.register<InternalRunCreateParams, InternalRunCreateResponse>(
    'internal.run.create',
    ['admin'],
    async (params) => {
      if (!params?.planId) {
        throw GatewayError.invalidParams('planId is required');
      }

      if (params.acceptedPlan === undefined || params.acceptedPlan === null || typeof params.acceptedPlan !== 'object') {
        throw GatewayError.invalidParams('acceptedPlan is required');
      }

      const runId = `run-${params.planId}`;

      eventStore.append({
        run_id: runId,
        plan_id: params.planId,
        event_type: 'RUN_CREATED',
        payload: {
          source: 'internal.run.create',
          compile_run_id: params.compileRunId,
        },
      });

      if (params.compileRunId) {
        eventStore.append({
          run_id: runId,
          plan_id: params.planId,
          event_type: 'RUN_LINKED',
          payload: {
            compile_run_id: params.compileRunId,
            runtime_run_id: runId,
          },
        });
      }

      return {
        run_id: runId,
        plan_id: params.planId,
        status: 'created',
      };
    }
  );

  rpcHandler.register<InternalRunEventsParams, InternalRunEventsResponse>(
    'internal.runs.events',
    ['admin'],
    async (params) => {
      if (!params.runId) {
        throw GatewayError.invalidParams('runId is required');
      }

      const limit = toPositiveLimit(params.limit);
      if (params.cursor !== undefined && params.offset !== undefined) {
        throw GatewayError.invalidParams('offset and cursor cannot be provided together');
      }

      const cursorOffset = cursorToOffset(params.cursor);
      const offset = cursorOffset !== undefined
        ? cursorOffset
        : toNonNegativeOffset(params.offset);
      const eventTypes = validateEventTypes(params.eventTypes);

      let mergedEvents: DeterministicRunEvent[];
      if (repository.listRunEvents) {
        const runIds = params.relatedRunId ? [params.runId, params.relatedRunId] : [params.runId];
        mergedEvents = sortEventsStable(repository.listRunEvents({
          run_ids: runIds,
          event_types: eventTypes,
        }));
      } else {
        mergedEvents = mergeRunEvents(repository, eventStore, params.runId, params.relatedRunId);
      }

      const filteredEvents = repository.listRunEvents
        ? mergedEvents
        : eventTypes
          ? mergedEvents.filter((event) => eventTypes.includes(event.event_type))
          : mergedEvents;

      const slicedEvents = filteredEvents.slice(offset, limit ? offset + limit : undefined);
      const nextOffset = (offset + slicedEvents.length) < filteredEvents.length
        ? offset + slicedEvents.length
        : undefined;
      const nextCursor = nextOffset !== undefined ? String(nextOffset) : undefined;

      return {
        runId: params.runId,
        offset,
        cursor: params.cursor,
        returned: slicedEvents.length,
        nextOffset,
        nextCursor,
        events: slicedEvents,
      };
    }
  );

  rpcHandler.register<InternalRunEventsPruneParams, InternalRunEventsPruneResponse>(
    'internal.runs.events.prune',
    ['admin'],
    async (params) => {
      if (!repository.pruneRunEvents) {
        throw GatewayError.internalError('run event prune is not available in current repository');
      }

      const beforeTsMs = toPruneBeforeTsMs(params.beforeTsMs);
      const keepLatestPerRun = toPruneKeepLatestPerRun(params.keepLatestPerRun);
      const eventTypes = validateEventTypes(params.eventTypes);
      const normalizedRunFilters = normalizeRunIds(params.runId, params.runIds);

      return repository.pruneRunEvents({
        before_ts_ms: beforeTsMs,
        run_id: normalizedRunFilters.runId,
        run_ids: normalizedRunFilters.runIds,
        event_types: eventTypes,
        keep_latest_per_run: keepLatestPerRun,
      });
    }
  );

  rpcHandler.register<InternalRunsTimelineParams, InternalRunsTimelineResponse>(
    'internal.runs.timeline',
    ['admin'],
    async (params) => {
      if (!params.runId) {
        throw GatewayError.invalidParams('runId is required');
      }

      const mergedEvents = mergeRunEvents(repository, eventStore, params.runId, params.relatedRunId);
      const phases = mergedEvents.map((event) => ({
        phase: eventTypeToPhase(event.event_type),
        ts_ms: event.ts_ms,
        run_id: event.run_id,
        event_type: event.event_type,
        payload: event.payload,
      }));

      return {
        runId: params.runId,
        relatedRunId: params.relatedRunId,
        status: deriveTimelineStatus(mergedEvents),
        phases,
      };
    }
  );

  rpcHandler.register<InternalRunsReplayParams, InternalRunsReplayResponse>(
    'internal.runs.replay',
    ['admin'],
    async (params) => {
      if (!params.runId) {
        throw GatewayError.invalidParams('runId is required');
      }

      const mode = params.mode ?? 'facts_only';
      if (mode !== 'facts_only' && mode !== 'reexecute_tools') {
        throw GatewayError.invalidParams('mode must be facts_only or reexecute_tools');
      }

      const allowTools = toReplayAllowTools(params.allowTools);
      const maxAttempts = toReplayMaxAttempts(params.maxAttempts);
      const enableExecution = toReplayEnableExecution(params.enableExecution);
      const reexecutionIdempotencyKey = toReplayIdempotencyKey(params.reexecutionIdempotencyKey);

      if (mode === 'reexecute_tools' && enableExecution && !reexecutionIdempotencyKey) {
        throw GatewayError.invalidParams('reexecutionIdempotencyKey is required when mode=reexecute_tools and enableExecution=true');
      }

      if (params.relatedRunId !== undefined && params.relatedRunId.trim().length === 0) {
        throw GatewayError.invalidParams('relatedRunId cannot be empty when provided');
      }

      const mergedEvents = mergeRunEvents(repository, eventStore, params.runId, params.relatedRunId);
      const phases = mergedEvents.map((event) => ({
        phase: eventTypeToPhase(event.event_type),
        ts_ms: event.ts_ms,
        run_id: event.run_id,
        event_type: event.event_type,
        payload: event.payload,
      }));

      const indexes = extractFactsAndArtifacts(mergedEvents);

      const summary = {
        total_events: mergedEvents.length,
        first_ts_ms: mergedEvents[0]?.ts_ms,
        last_ts_ms: mergedEvents[mergedEvents.length - 1]?.ts_ms,
        compile_run_id: mergedEvents.find((event) => event.event_type === 'PLAN_COMPILE_REQUESTED')?.run_id,
        runtime_run_id: mergedEvents.find((event) => event.event_type === 'RUN_CREATED')?.run_id,
        event_counts: toEventCounts(mergedEvents),
        facts_count: indexes.facts.length,
        artifacts_count: indexes.artifacts.length,
      };

      const toolRegistry = getToolRegistry?.();
      const candidateTools = extractReplayToolCandidates(mergedEvents).slice(0, maxAttempts);
      const skipped: Array<{
        tool: string;
        reason: 'execution_disabled' | 'not_allowlisted' | 'tool_not_found' | 'non_idempotent' | 'execution_failed';
      }> = [];
      let eligibleSteps = 0;
      let executedSteps = 0;
      const executedToolNames: string[] = [];

      if (mode === 'reexecute_tools') {
        if (enableExecution && reexecutionIdempotencyKey) {
          const priorCompleted = mergedEvents.find((event) => (
            event.event_type === 'REPLAY_REEXECUTION_COMPLETED'
            && typeof (event.payload as Record<string, unknown>)?.idempotency_key === 'string'
            && (event.payload as Record<string, unknown>).idempotency_key === reexecutionIdempotencyKey
          ));
          if (priorCompleted) {
            const payload = priorCompleted.payload as Record<string, unknown>;
            return {
              runId: params.runId,
              relatedRunId: params.relatedRunId,
              mode,
              status: deriveTimelineStatus(mergedEvents),
              summary,
              indexes,
              phases,
              reexecution: {
                status: 'dry_run_only',
                attempted_steps: typeof payload.attempted_steps === 'number' ? payload.attempted_steps : candidateTools.length,
                eligible_steps: typeof payload.eligible_steps === 'number' ? payload.eligible_steps : 0,
                executed_steps: typeof payload.executed_steps === 'number' ? payload.executed_steps : 0,
                skipped,
                message: 'reexecute_tools request reused existing idempotent execution result',
              },
            };
          }
        }

        for (const invocation of candidateTools) {
          const toolName = invocation.tool;
          const normalizedToolName = normalizeReplayToolName(toolName);
          if (allowTools && !allowTools.has(toolName) && !allowTools.has(normalizedToolName)) {
            skipped.push({ tool: toolName, reason: 'not_allowlisted' });
            continue;
          }

          const tool = toolRegistry?.getTool(toolName) ?? toolRegistry?.getTool(normalizedToolName);
          if (!tool) {
            skipped.push({ tool: toolName, reason: 'tool_not_found' });
            continue;
          }

          const sideEffect = tool.manifest?.side_effect;
          if (sideEffect && sideEffect !== 'none' && sideEffect !== 'idempotent') {
            skipped.push({ tool: toolName, reason: 'non_idempotent' });
            continue;
          }

          eligibleSteps += 1;

          if (!enableExecution) {
            skipped.push({ tool: toolName, reason: 'execution_disabled' });
            continue;
          }

          try {
            const allowlist = new ToolAllowlist([tool.name]);
            const enforcer = new ToolEnforcer(toolRegistry as ToolRegistry, allowlist);
            await tool.execute(invocation.args, {
              cwd: process.cwd(),
              allowlist,
              enforcer,
              workspaceRoot: process.cwd(),
            });
            executedSteps += 1;
            executedToolNames.push(toolName);
          } catch {
            skipped.push({ tool: toolName, reason: 'execution_failed' });
          }
        }

        eventStore.append({
          run_id: params.runId,
          event_type: 'REPLAY_REEXECUTION_REQUESTED',
          payload: {
            related_run_id: params.relatedRunId,
            mode,
            enable_execution: enableExecution,
            idempotency_key: reexecutionIdempotencyKey,
            attempted_steps: candidateTools.length,
            eligible_steps: eligibleSteps,
          },
        });

        for (const toolName of executedToolNames) {
          eventStore.append({
            run_id: params.runId,
            event_type: 'REPLAY_REEXECUTION_STEP_EXECUTED',
            payload: {
              tool: toolName,
              idempotency_key: reexecutionIdempotencyKey,
            },
          });
        }

        for (const entry of skipped) {
          eventStore.append({
            run_id: params.runId,
            event_type: 'REPLAY_REEXECUTION_STEP_SKIPPED',
            payload: {
              tool: entry.tool,
              reason: entry.reason,
              idempotency_key: reexecutionIdempotencyKey,
            },
          });
        }

        eventStore.append({
          run_id: params.runId,
          event_type: 'REPLAY_REEXECUTION_COMPLETED',
          payload: {
            idempotency_key: reexecutionIdempotencyKey,
            attempted_steps: candidateTools.length,
            eligible_steps: eligibleSteps,
            executed_steps: executedSteps,
            skipped_steps: skipped.length,
          },
        });
      }

      return {
        runId: params.runId,
        relatedRunId: params.relatedRunId,
        mode,
        status: deriveTimelineStatus(mergedEvents),
        summary,
        indexes,
        phases,
        reexecution: mode === 'reexecute_tools'
          ? {
            status: 'dry_run_only',
            attempted_steps: candidateTools.length,
            eligible_steps: eligibleSteps,
            executed_steps: executedSteps,
            skipped,
            message: enableExecution
              ? 'reexecute_tools dry-run skeleton: attempted safe/idempotent execution with guardrails'
              : 'reexecute_tools dry-run skeleton: candidates analyzed, execution is intentionally disabled',
          }
          : undefined,
      };
    }
  );

  rpcHandler.register<InternalRuntimeExecuteDryRunParams, InternalRuntimeExecuteDryRunResponse>(
    'internal.runtime.executeDryRun',
    ['admin'],
    async (params) => {
      if (!params?.goalId) {
        throw GatewayError.invalidParams('goalId is required');
      }

      const basePlan = buildPlanForGoal(params.goalId);
      const plan = (params.goalOverride || params.workItemOverrides)
        ? buildPlanForGoalWithOverrides(params)
        : basePlan;

      const diff = computePlanDiff(basePlan, plan);

      const toolRegistry = getToolRegistry?.();
      if (!toolRegistry) {
        throw GatewayError.internalError('tool registry is not available');
      }

      const compiler = new PlanCompiler(toolRegistry);
      const compileRunId = `compile-${plan.plan_id}`;

      eventStore.append({
        run_id: compileRunId,
        plan_id: plan.plan_id,
        event_type: 'PLAN_COMPILE_REQUESTED',
        payload: {
          has_runtime_profile: params.runtimeProfile !== undefined,
          source: 'internal.runtime.executeDryRun',
        },
      });

      const compileResult = compiler.compile(plan, params.runtimeProfile);

      eventStore.append({
        run_id: compileRunId,
        plan_id: compileResult.acceptedPlan?.planId ?? plan.plan_id,
        event_type: compileResult.ok ? 'PLAN_COMPILE_COMPLETED' : 'PLAN_COMPILE_FAILED',
        payload: {
          ok: compileResult.ok,
          error_count: compileResult.errors.length,
          source: 'internal.runtime.executeDryRun',
        },
      });

      const compileResponse: InternalPlanCompileResponse = {
        ...compileResult,
        compile_run_id: compileRunId,
      };

      let runResponse: InternalRunCreateResponse | undefined;
      let replayRunId = compileRunId;
      let replayRelatedRunId: string | undefined;

      if (compileResult.ok && compileResult.acceptedPlan) {
        const runId = `run-${compileResult.acceptedPlan.planId}`;
        eventStore.append({
          run_id: runId,
          plan_id: compileResult.acceptedPlan.planId,
          event_type: 'RUN_CREATED',
          payload: {
            source: 'internal.runtime.executeDryRun',
            compile_run_id: compileRunId,
          },
        });
        eventStore.append({
          run_id: runId,
          plan_id: compileResult.acceptedPlan.planId,
          event_type: 'RUN_LINKED',
          payload: {
            compile_run_id: compileRunId,
            runtime_run_id: runId,
            source: 'internal.runtime.executeDryRun',
          },
        });

        runResponse = {
          run_id: runId,
          plan_id: compileResult.acceptedPlan.planId,
          status: 'created',
        };
        replayRunId = compileRunId;
        replayRelatedRunId = runId;
      }

      const replayEvents = mergeRunEvents(repository, eventStore, replayRunId, replayRelatedRunId);
      const replayPhases = replayEvents.map((event) => ({
        phase: eventTypeToPhase(event.event_type),
        ts_ms: event.ts_ms,
        run_id: event.run_id,
        event_type: event.event_type,
        payload: event.payload,
      }));
      const replayIndexes = extractFactsAndArtifacts(replayEvents);

      const replay: InternalRunsReplayResponse = {
        runId: replayRunId,
        relatedRunId: replayRelatedRunId,
        mode: 'facts_only',
        status: deriveTimelineStatus(replayEvents),
        summary: {
          total_events: replayEvents.length,
          first_ts_ms: replayEvents[0]?.ts_ms,
          last_ts_ms: replayEvents[replayEvents.length - 1]?.ts_ms,
          compile_run_id: replayEvents.find((event) => event.event_type === 'PLAN_COMPILE_REQUESTED')?.run_id,
          runtime_run_id: replayEvents.find((event) => event.event_type === 'RUN_CREATED')?.run_id,
          event_counts: toEventCounts(replayEvents),
          facts_count: replayIndexes.facts.length,
          artifacts_count: replayIndexes.artifacts.length,
        },
        indexes: replayIndexes,
        phases: replayPhases,
      };

      const report = buildDryRunReport(compileResult.ok, plan, diff, replay);

      options?.onDryRunComplete?.({
        ok: compileResult.ok,
        planStepCount: plan.steps.length,
        changedStepCount: diff.changedStepCount,
        compileErrorCodes: compileResult.errors.map((error) => error.code),
        timestamp: Date.now(),
      });

      return {
        ok: compileResult.ok,
        goalId: params.goalId,
        basePlan,
        plan,
        diff,
        report,
        compile: compileResponse,
        run: runResponse,
        replay,
      };
    }
  );

  rpcHandler.register<InternalRunGetParams, Run>(
    'internal.run.get',
    ['admin'],
    async (params) => {
      if (!params.runId) {
        throw GatewayError.invalidParams('runId is required');
      }

      const run = repository.getRun(params.runId);
      if (!run) {
        throw new GatewayError(ErrorCodes.RUN_NOT_FOUND, `run not found: ${params.runId}`);
      }

      return run;
    }
  );

  rpcHandler.register<InternalRunsByWorkItemParams, InternalRunsByWorkItemResponse>(
    'internal.runs.byWorkItem',
    ['admin'],
    async (params) => {
      if (!params.workItemId) {
        throw GatewayError.invalidParams('workItemId is required');
      }

      const workItem = repository.getWorkItem(params.workItemId);
      if (!workItem) {
        throw GatewayError.notFound('workitem', params.workItemId);
      }

      return {
        workItem,
        runs: repository.getRunsByWorkItem(params.workItemId),
      };
    }
  );

  rpcHandler.register<InternalToolManifestValidateParams, InternalToolManifestValidateResponse>(
    'internal.toolManifest.validate',
    ['admin'],
    async (params) => {
      const toolRegistry = getToolRegistry?.();
      if (!toolRegistry) {
        throw GatewayError.internalError('tool registry is not available');
      }

      const validator = new ToolManifestValidator(undefined, {
        requireManifest: params.requireManifest ?? false,
      });

      return validator.validateRegistry(toolRegistry);
    }
  );
}
