/**
 * TUI Gateway Client - High-level client for TUI operations
 */

import { GatewayClient, type GatewayClientOptions } from './gateway-client.js';
import type { Goal, GoalStatus, WorkItem } from '../../work-order/types/index.js';

export interface TuiGatewayClientOptions extends GatewayClientOptions {
  // Additional TUI-specific options can be added here
}

export interface GoalSubmitParams {
  title: string;
  description: string;
  success_criteria: Goal['success_criteria'];
  priority?: number;
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
}

export interface GoalListParams {
  status?: GoalStatus;
  limit?: number;
  offset?: number;
}

export interface WorkItemListParams {
  goalId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface WorkItemRetryParams {
  workItemId: string;
}

export interface GatewayStatus {
  isRunning: boolean;
  address: string | null;
  connections: {
    total: number;
    authenticated: number;
  };
  daemonConnected: boolean;
  schedulerConnected: boolean;
}

export interface SchedulerCapabilitiesSummary {
  totalModels: number;
  totalProviders: number;
  totalTools: number;
  totalMCPServers: number;
  totalSkills: number;
  totalAgents: number;
}

export interface SchedulerCapabilitiesResponse {
  timestamp: number;
  schedulerConnected: boolean;
  capabilities: {
    summary: SchedulerCapabilitiesSummary;
    models?: Array<{
      name: string;
      displayName: string;
      providers: string[];
      capabilities: string[];
    }>;
    providers?: Array<{
      name: string;
      protocol: string;
      enabled: boolean;
      priority: number;
      baseUrl?: string;
    }>;
    agents?: Array<{
      id: string;
      name: string;
      enabled: boolean;
    }>;
  };
}

export interface GatewayEvent {
  event: string;
  data: unknown;
}

export interface InternalRuntimeRunEventsParams {
  runId: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  eventTypes?: Array<
    | 'PLAN_COMPILE_REQUESTED'
    | 'PLAN_COMPILE_COMPLETED'
    | 'PLAN_COMPILE_FAILED'
    | 'RUN_CREATED'
    | 'RUN_LINKED'
    | 'REPLAY_REEXECUTION_REQUESTED'
    | 'REPLAY_REEXECUTION_STEP_EXECUTED'
    | 'REPLAY_REEXECUTION_STEP_SKIPPED'
    | 'REPLAY_REEXECUTION_COMPLETED'
  >;
  relatedRunId?: string;
}

export interface InternalRuntimeRunEventsResponse {
  runId: string;
  offset: number;
  cursor?: string;
  returned: number;
  nextOffset?: number;
  nextCursor?: string;
  events: Array<{
    event_id: string;
    sequence?: number;
    run_id: string;
    plan_id?: string;
    event_type: string;
    ts_ms: number;
    payload: Record<string, unknown>;
  }>;
}

export interface InternalRuntimeRunEventsPruneParams {
  beforeTsMs: number;
  runId?: string;
  runIds?: string[];
  eventTypes?: Array<
    | 'PLAN_COMPILE_REQUESTED'
    | 'PLAN_COMPILE_COMPLETED'
    | 'PLAN_COMPILE_FAILED'
    | 'RUN_CREATED'
    | 'RUN_LINKED'
    | 'REPLAY_REEXECUTION_REQUESTED'
    | 'REPLAY_REEXECUTION_STEP_EXECUTED'
    | 'REPLAY_REEXECUTION_STEP_SKIPPED'
    | 'REPLAY_REEXECUTION_COMPLETED'
  >;
  keepLatestPerRun?: number;
}

export interface InternalRuntimeRunEventsPruneResponse {
  deleted: number;
}

export interface InternalRuntimeTimelineResponse {
  runId: string;
  relatedRunId?: string;
  status: 'in_progress' | 'failed' | 'completed' | 'unknown';
  phases: Array<{
    phase: 'compile_requested' | 'compile_completed' | 'compile_failed' | 'run_created' | 'run_linked';
    ts_ms: number;
    run_id: string;
    event_type: string;
    payload: Record<string, unknown>;
  }>;
}

export interface InternalRuntimeReplayResponse {
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
    event_counts: Record<string, number>;
    facts_count: number;
    artifacts_count: number;
  };
  indexes: {
    facts: Array<Record<string, unknown>>;
    artifacts: Array<Record<string, unknown>>;
  };
  phases: Array<Record<string, unknown>>;
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
  basePlan: Record<string, unknown>;
  plan: Record<string, unknown>;
  diff: Record<string, unknown>;
  report: Record<string, unknown>;
  compile: Record<string, unknown>;
  run?: Record<string, unknown>;
  replay: InternalRuntimeReplayResponse;
}

export interface RuntimeRolloutStatusResponse {
  mode: 'legacy' | 'shadow' | 'canary';
  schedulerFlags: {
    deterministicRuntimeEnabled: boolean;
    planCompilerEnabled: boolean;
    toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  };
  rollout: {
    shadowModeEnabled: boolean;
    canaryPercent: number;
    rollbackOnFailure: boolean;
    lanePercents: {
      dryRun: number;
      compile: number;
      replay: number;
    };
  };
  metrics: {
    dryRunsTotal: number;
    dryRunsSucceeded: number;
    dryRunsFailed: number;
    successRate: number;
    averagePlanStepCount: number;
    averageChangedStepCount: number;
    failureCodeCounts: Record<string, number>;
    lastDryRunAt?: number;
  };
}

export interface RuntimeRolloutUpdateParams {
  shadowModeEnabled?: boolean;
  canaryPercent?: number;
  rollbackOnFailure?: boolean;
  rollbackToLegacy?: boolean;
}

export class TuiGatewayClient {
  private client: GatewayClient;

  // Event callbacks
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onEvent?: (evt: GatewayEvent) => void;
  onError?: (error: Error) => void;

  readonly url: string;

  constructor(options: TuiGatewayClientOptions = {}) {
    this.client = new GatewayClient(options);
    this.url = this.client.url;

    // Wire up callbacks
    this.client.onConnected = () => this.onConnected?.();
    this.client.onDisconnected = (reason) => this.onDisconnected?.(reason);
    this.client.onEvent = (event, data) => this.onEvent?.({ event, data });
    this.client.onError = (error) => this.onError?.(error);
  }

  /**
   * Start the client
   */
  start(): void {
    this.client.start();
  }

  /**
   * Stop the client
   */
  stop(): void {
    this.client.stop();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client.isConnected();
  }

  // ============================================================================
  // System Methods
  // ============================================================================

  /**
   * Ping the gateway
   */
  async ping(): Promise<{ pong: number }> {
    return this.client.request('system.ping');
  }

  /**
   * Get available methods
   */
  async getMethods(): Promise<{ methods: string[] }> {
    return this.client.request('system.methods');
  }

  /**
   * Get gateway stats
   */
  async getStats(): Promise<GatewayStatus> {
    return this.client.request('system.stats');
  }

  async getSystemCapabilities(): Promise<SchedulerCapabilitiesResponse> {
    return this.client.request('system.capabilities');
  }

  // ============================================================================
  // Goal Methods
  // ============================================================================

  /**
   * Submit a new goal
   */
  async submitGoal(params: GoalSubmitParams): Promise<Goal> {
    return this.client.request('goal.submit', params);
  }

  /**
   * Get goal status
   */
  async getGoalStatus(goalId: string): Promise<Goal> {
    return this.client.request('goal.status', { goalId });
  }

  /**
   * Cancel a goal
   */
  async cancelGoal(goalId: string, reason?: string): Promise<{ success: boolean }> {
    return this.client.request('goal.cancel', { goalId, reason });
  }

  /**
   * List goals
   */
  async listGoals(params?: GoalListParams): Promise<{ goals: Goal[]; total: number }> {
    return this.client.request('goal.list', params || {});
  }

  async deleteGoal(goalId: string): Promise<{ success: boolean }> {
    return this.client.request('goal.delete', { goalId });
  }

  /**
   * Subscribe to goal events
   */
  async subscribeToGoal(goalId: string): Promise<{ success: boolean }> {
    return this.client.request('goal.subscribe', { goalId });
  }

  /**
   * Unsubscribe from goal events
   */
  async unsubscribeFromGoal(goalId: string): Promise<{ success: boolean }> {
    return this.client.request('goal.unsubscribe', { goalId });
  }

  // ============================================================================
  // WorkItem Methods
  // ============================================================================

  /**
   * Get a work item
   */
  async getWorkItem(workItemId: string): Promise<WorkItem> {
    return this.client.request('workitem.get', { workItemId });
  }

  /**
   * List work items
   */
  async listWorkItems(params?: WorkItemListParams): Promise<{ workItems: WorkItem[]; total: number }> {
    return this.client.request('workitem.list', params || {});
  }

  /**
   * Get work items for a goal
   */
  async getWorkItemsByGoal(goalId: string): Promise<{ workItems: WorkItem[] }> {
    return this.client.request('workitem.byGoal', { goalId });
  }

  /**
   * Get runs for a work item
   */
  async getWorkItemRuns(workItemId: string): Promise<{ runs: unknown[] }> {
    return this.client.request('workitem.runs', { workItemId });
  }

  async retryWorkItem(params: WorkItemRetryParams): Promise<{ success: boolean; workItem: WorkItem }> {
    return this.client.request('workitem.retry', params);
  }

  // ============================================================================
  // Escalation Methods
  // ============================================================================

  /**
   * List pending escalations
   */
  async listEscalations(): Promise<{ escalations: unknown[] }> {
    return this.client.request('escalation.list', {});
  }

  /**
   * Resolve an escalation
   */
  async resolveEscalation(escalationId: string, resolution: unknown): Promise<{ success: boolean }> {
    return this.client.request('escalation.resolve', { escalationId, resolution });
  }

  // ============================================================================
  // Approval Methods
  // ============================================================================

  /**
   * List pending approvals
   */
  async listApprovals(): Promise<{ approvals: unknown[] }> {
    return this.client.request('approval.list', {});
  }

  /**
   * Approve a request
   */
  async approve(approvalId: string): Promise<{ success: boolean }> {
    return this.client.request('approval.approve', { approvalId });
  }

  /**
   * Reject a request
   */
  async reject(approvalId: string, reason?: string): Promise<{ success: boolean }> {
    return this.client.request('approval.reject', { approvalId, reason });
  }

  async getInternalRuntimeConfig(): Promise<{
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
  }> {
    return this.client.request('internal.runtime.config', {});
  }

  async getRuntimeRolloutStatus(): Promise<RuntimeRolloutStatusResponse> {
    return this.client.request('system.runtime.rollout.status', {});
  }

  async updateRuntimeRollout(params: RuntimeRolloutUpdateParams): Promise<RuntimeRolloutStatusResponse> {
    return this.client.request('system.runtime.rollout.update', params);
  }

  async getInternalPlan(goalId: string): Promise<Record<string, unknown>> {
    return this.client.request('internal.plan.get', { goalId });
  }

  async compileInternalPlan(plan: unknown, runtimeProfile?: unknown): Promise<Record<string, unknown>> {
    return this.client.request('internal.plan.compile', { plan, runtimeProfile });
  }

  async createInternalRun(planId: string, acceptedPlan: unknown, compileRunId?: string): Promise<Record<string, unknown>> {
    return this.client.request('internal.run.create', { planId, acceptedPlan, compileRunId });
  }

  async getInternalRunEvents(params: InternalRuntimeRunEventsParams): Promise<InternalRuntimeRunEventsResponse> {
    return this.client.request('internal.runs.events', params);
  }

  async pruneInternalRunEvents(
    params: InternalRuntimeRunEventsPruneParams
  ): Promise<InternalRuntimeRunEventsPruneResponse> {
    return this.client.request('internal.runs.events.prune', params);
  }

  async getInternalRunTimeline(runId: string, relatedRunId?: string): Promise<InternalRuntimeTimelineResponse> {
    return this.client.request('internal.runs.timeline', { runId, relatedRunId });
  }

  async replayInternalRun(
    runId: string,
    relatedRunId?: string,
    mode: 'facts_only' | 'reexecute_tools' = 'facts_only',
    options?: {
      allowTools?: string[];
      maxAttempts?: number;
      enableExecution?: boolean;
      reexecutionIdempotencyKey?: string;
    }
  ): Promise<InternalRuntimeReplayResponse> {
    return this.client.request('internal.runs.replay', {
      runId,
      relatedRunId,
      mode,
      ...(options?.allowTools ? { allowTools: options.allowTools } : {}),
      ...(options?.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
      ...(options?.enableExecution !== undefined ? { enableExecution: options.enableExecution } : {}),
      ...(options?.reexecutionIdempotencyKey
        ? { reexecutionIdempotencyKey: options.reexecutionIdempotencyKey }
        : {}),
    });
  }

  async executeInternalRuntimeDryRun(params: InternalRuntimeExecuteDryRunParams): Promise<InternalRuntimeExecuteDryRunResponse> {
    return this.client.request('internal.runtime.executeDryRun', params);
  }
}
