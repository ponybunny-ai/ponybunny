/**
 * Scheduler Core Implementation
 *
 * The main orchestrator that coordinates all scheduler components
 * to execute goals through the 8-phase lifecycle.
 */

import { randomUUID } from 'crypto';
import type { Goal, WorkItem } from '../../work-order/types/index.js';
import type {
  ExecutionRequest,
  ExecutionResult,
  ExecutionError,
} from '../../runtime/execution-boundary/index.js';
import type { RuntimeEvent } from '../../runtime/event-bus/index.js';
import type {
  LaneId,
  SchedulerState,
  SchedulerEvent,
  SchedulerEventHandler,
  LaneStatus,
} from '../types.js';
import type {
  ISchedulerCore,
  SchedulerConfig,
  SchedulerDependencies,
  GoalExecutionState,
  SchedulerMetrics,
  WorkItemExecutionContext,
} from './types.js';
import { debug } from '../../debug/index.js';
import {
  buildEventedDispatchCheckpoint,
  readEventedDispatchCheckpoint,
} from '../evented-dispatch-checkpoint.js';
import { resolveEffectiveModelSelection } from '../../infra/llm/provider-manager/effective-model-resolution.js';
import {
  materializeCompatibilityRunModelProjection,
  materializeCompatibilitySelectedModelProjection,
} from '../../infra/llm/provider-manager/model-selection-compatibility.js';

const DEFAULT_CONFIG: SchedulerConfig = {
  tickIntervalMs: 1000,
  maxConcurrentGoals: 5,
  autoStart: false,
  debug: false,
  executionMode: 'direct',
  deterministicRuntimeEnabled: false,
  planCompilerEnabled: false,
  toolRoutingMode: 'legacy',
  runtimeRollout: {
    shadowModeEnabled: false,
    canaryPercent: 0,
    rollbackOnFailure: true,
    lanePercents: {
      dryRun: 0,
      compile: 0,
      replay: 0,
    },
  },
};

const INITIAL_LANE_STATUS: LaneStatus = {
  laneId: 'main',
  activeCount: 0,
  queuedCount: 0,
  isAvailable: true,
};

export class SchedulerCore implements ISchedulerCore {
  private config: SchedulerConfig;
  private deps: SchedulerDependencies;
  private state: SchedulerState;
  private goalStates: Map<string, GoalExecutionState> = new Map();
  private activeExecutions: Map<string, WorkItemExecutionContext> = new Map();
  private eventHandlers: Set<SchedulerEventHandler> = new Set();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private metrics: SchedulerMetrics;
  private runtimeEventUnsubscribe: (() => void) | null = null;

  constructor(deps: SchedulerDependencies, config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.state = this.createInitialState();
    this.metrics = this.createInitialMetrics();
    this.ensureRuntimeEventSubscription();
  }

  private createInitialState(): SchedulerState {
    return {
      status: 'idle',
      activeGoals: [],
      lanes: {
        main: { ...INITIAL_LANE_STATUS, laneId: 'main' },
        subagent: { ...INITIAL_LANE_STATUS, laneId: 'subagent' },
        cron: { ...INITIAL_LANE_STATUS, laneId: 'cron' },
        session: { ...INITIAL_LANE_STATUS, laneId: 'session' },
      },
      errorCount: 0,
    };
  }

  private createInitialMetrics(): SchedulerMetrics {
    return {
      totalGoalsProcessed: 0,
      totalWorkItemsCompleted: 0,
      totalRunsExecuted: 0,
      averageWorkItemDurationMs: 0,
      successRate: 1,
      currentActiveGoals: 0,
      currentActiveWorkItems: 0,
    };
  }

  getState(): SchedulerState {
    return { ...this.state };
  }

  precheckReplay(runId: string): {
    status:
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
      | 'replay_attempt_not_allowed'
      | 'not_evented_execution';
    eligible: boolean;
    rejectionReasons: string[];
    expectedConsequences: string[];
    originalRun?: ReturnType<SchedulerDependencies['repository']['getRun']>;
  } {
    if (this.config.executionMode !== 'evented') {
      return {
        status: 'not_evented_execution',
        eligible: false,
        rejectionReasons: ['not_evented_execution'],
        expectedConsequences: [],
      };
    }

    return this.deps.repository.precheckEventedManualReplay(runId);
  }

  async replayRun(runId: string): Promise<{
    status:
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
      | 'replay_attempt_not_allowed'
      | 'not_evented_execution';
    originalRun?: ReturnType<SchedulerDependencies['repository']['getRun']>;
    replacementRun?: ReturnType<SchedulerDependencies['repository']['getRun']>;
  }> {
    if (this.config.executionMode !== 'evented') {
      return { status: 'not_evented_execution' };
    }

    const replay = this.deps.repository.startEventedManualReplay(runId, {
      requestedAt: Date.now(),
      requestedReason: 'manual_operator_request',
    });

    if (replay.status !== 'replay_started' || !replay.replacementRun) {
      return {
        status: replay.status,
        originalRun: replay.originalRun,
      };
    }

    const goal = this.deps.repository.getGoal(replay.replacementRun.goal_id);
    const workItem = this.deps.repository.getWorkItem(replay.replacementRun.work_item_id);
    if (!goal || !workItem) {
      throw new Error(
        `Replay created replacement run ${replay.replacementRun.id} without a durable goal/work item`
      );
    }

    const originalCheckpoint = replay.originalRun
      ? readEventedDispatchCheckpoint(replay.originalRun.context)
      : null;
    const modelResult = this.deps.modelSelector.selectModel(workItem, goal);
    const laneResult = this.deps.laneSelector.selectLane(workItem, goal);
    const laneId = (originalCheckpoint?.lane_id ?? laneResult.laneId) as LaneId;
    const projectedModel = this.resolveProjectedExecutionModel(
      typeof replay.replacementRun.context?.selected_model === 'string'
        ? replay.replacementRun.context.selected_model
        : undefined,
      modelResult.model
    );
    const model = projectedModel.model;
    const replayRunSelectionProjection = materializeCompatibilitySelectedModelProjection({
      selectedModel: model,
    });

    const goalState = this.goalStates.get(goal.id) ?? {
      goalId: goal.id,
      status: 'running' as const,
      currentWorkItemId: workItem.id,
      currentRunId: replay.replacementRun.id,
      startedAt: Date.now(),
    };
    goalState.status = 'running';
    goalState.currentWorkItemId = workItem.id;
    goalState.currentRunId = replay.replacementRun.id;
    this.goalStates.set(goal.id, goalState);
    if (!this.state.activeGoals.includes(goal.id)) {
      this.state.activeGoals.push(goal.id);
    }

    const context: WorkItemExecutionContext = {
      workItem,
      goal,
      run: replay.replacementRun,
      laneId,
      model,
      startedAt: Date.now(),
    };
    this.activeExecutions.set(replay.replacementRun.id, context);
    this.deps.laneSelector.incrementActive(laneId);
    this.updateLaneStatus(laneId);

    this.emitEvent({
      type: 'run_started',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: replay.replacementRun.id,
      data: {
        selected_model: replayRunSelectionProjection.selected_model,
        replay_of_run_id: replay.originalRun?.id,
      },
    });

    this.emitEvent({
      type: 'work_item_in_progress',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: replay.replacementRun.id,
      data: { stage: 'execution', progress: 10, replay_of_run_id: replay.originalRun?.id },
    });

    await this.dispatchExecution(context);

    return {
      status: replay.status,
      originalRun: replay.originalRun,
      replacementRun: replay.replacementRun,
    };
  }

  async start(): Promise<void> {
    if (this.state.status === 'running') {
      return;
    }

    this.ensureRuntimeEventSubscription();
    this.state.status = 'running';
    this.debug('Scheduler started');

    // Start tick loop
    this.tickTimer = setInterval(() => {
      this.tick().catch((error) => {
        this.debug('Tick error:', error);
        this.state.errorCount++;
      });
    }, this.config.tickIntervalMs);
  }

  async pause(): Promise<void> {
    if (this.state.status !== 'running') {
      return;
    }

    this.state.status = 'paused';
    this.debug('Scheduler paused');

    // Stop tick loop but don't abort active work
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  async resume(): Promise<void> {
    if (this.state.status !== 'paused') {
      return;
    }

    this.state.status = 'running';
    this.debug('Scheduler resumed');

    // Restart tick loop
    this.tickTimer = setInterval(() => {
      this.tick().catch((error) => {
        this.debug('Tick error:', error);
        this.state.errorCount++;
      });
    }, this.config.tickIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.state.status === 'stopped') {
      return;
    }

    this.state.status = 'stopping';
    this.debug('Scheduler stopping');

    // Stop tick loop
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    // Abort all active executions
    for (const [runId] of this.activeExecutions) {
      try {
        await this.deps.executionPort.abort(runId);
      } catch (error) {
        this.debug('Error aborting execution:', runId, error);
      }
    }
    this.activeExecutions.clear();
    this.runtimeEventUnsubscribe?.();
    this.runtimeEventUnsubscribe = null;

    this.state.status = 'stopped';
    this.debug('Scheduler stopped');
  }

  async submitGoal(goal: Goal): Promise<void> {
    this.debug('Submitting goal:', goal.id);

    // Set debug context
    debug.setContext({ goalId: goal.id });
    debug.custom('scheduler.goal.submitted', 'scheduler', {
      goalId: goal.id,
      title: goal.title,
      priority: goal.priority,
    });

    // Initialize goal execution state
    const goalState: GoalExecutionState = {
      goalId: goal.id,
      status: 'pending',
    };
    this.goalStates.set(goal.id, goalState);

    // Add to active goals if not already there
    if (!this.state.activeGoals.includes(goal.id)) {
      this.state.activeGoals.push(goal.id);
    }

    // Auto-start if configured
    if (this.config.autoStart && this.state.status === 'idle') {
      await this.start();
    }

    this.emitEvent({
      type: 'goal_started',
      timestamp: Date.now(),
      goalId: goal.id,
    });

    debug.clearContext();
  }

  async cancelGoal(goalId: string): Promise<void> {
    this.debug('Cancelling goal:', goalId);

    const goalState = this.goalStates.get(goalId);
    if (!goalState) {
      return;
    }

    // Abort any active executions for this goal
    for (const [runId, context] of this.activeExecutions) {
      if (context.goal.id === goalId) {
        try {
          await this.deps.executionPort.abort(runId);
          this.activeExecutions.delete(runId);
        } catch (error) {
          this.debug('Error aborting execution:', runId, error);
        }
      }
    }

    // Update goal state
    goalState.status = 'cancelled';
    goalState.completedAt = Date.now();

    // Remove from active goals
    this.state.activeGoals = this.state.activeGoals.filter((id) => id !== goalId);

    // Update repository
    this.deps.repository.updateGoalStatus(goalId, 'cancelled');
  }

  getGoalState(goalId: string): GoalExecutionState | undefined {
    return this.goalStates.get(goalId);
  }

  getAllGoalStates(): GoalExecutionState[] {
    return Array.from(this.goalStates.values());
  }

  getMetrics(): SchedulerMetrics {
    return {
      ...this.metrics,
      currentActiveGoals: this.state.activeGoals.length,
      currentActiveWorkItems: this.activeExecutions.size,
    };
  }

  applyRuntimeRollout(config: {
    deterministicRuntimeEnabled: boolean;
    planCompilerEnabled: boolean;
    toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
    runtimeRollout: SchedulerConfig['runtimeRollout'];
  }): void {
    this.config.deterministicRuntimeEnabled = config.deterministicRuntimeEnabled;
    this.config.planCompilerEnabled = config.planCompilerEnabled;
    this.config.toolRoutingMode = config.toolRoutingMode;
    this.config.runtimeRollout = {
      shadowModeEnabled: config.runtimeRollout.shadowModeEnabled,
      canaryPercent: config.runtimeRollout.canaryPercent,
      rollbackOnFailure: config.runtimeRollout.rollbackOnFailure,
      lanePercents: {
        dryRun: config.runtimeRollout.lanePercents.dryRun,
        compile: config.runtimeRollout.lanePercents.compile,
        replay: config.runtimeRollout.lanePercents.replay,
      },
    };
  }

  on(handler: SchedulerEventHandler): void {
    this.eventHandlers.add(handler);
  }

  off(handler: SchedulerEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Process a single scheduler tick
   */
  async tick(): Promise<void> {
    if (this.state.status !== 'running') {
      return;
    }

    this.state.lastTickAt = Date.now();

    // Only log tick if there are active goals or in verbose debug mode
    if (this.state.activeGoals.length > 0) {
      this.debug('Tick at', this.state.lastTickAt, `(${this.state.activeGoals.length} active goals)`);
    }

    // Process each active goal
    for (const goalId of this.state.activeGoals) {
      try {
        await this.processGoal(goalId);
      } catch (error) {
        this.debug('Error processing goal:', goalId, error);
        this.state.errorCount++;
      }
    }

    // Clean up completed goals
    this.cleanupCompletedGoals();
  }

  /**
   * Process a single goal
   */
  private async processGoal(goalId: string): Promise<void> {
    const goal = this.deps.repository.getGoal(goalId);
    if (!goal) {
      this.debug('Goal not found:', goalId);
      return;
    }

    const goalState = this.goalStates.get(goalId);
    if (!goalState) {
      return;
    }

    // Check for blocking escalations
    const hasBlockingEscalations = await this.deps.escalationHandler.hasBlockingEscalations(goalId);
    if (hasBlockingEscalations) {
      this.debug('Goal has blocking escalations:', goalId);
      return;
    }

    // Check budget
    const budgetStatus = this.deps.budgetTracker.getBudgetStatus(goal);
    if (budgetStatus.warningLevel === 'exceeded') {
      this.debug('Goal budget exceeded:', goalId);
      await this.handleBudgetExceeded(goal, goalState);
      return;
    }

    if (budgetStatus.warningLevel === 'critical' || budgetStatus.warningLevel === 'warning') {
      this.emitEvent({
        type: 'budget_warning',
        timestamp: Date.now(),
        goalId,
        data: { level: budgetStatus.warningLevel, status: budgetStatus },
      });
    }

    // Check if all work items are complete
    const allComplete = await this.deps.workItemManager.areAllWorkItemsComplete(goalId);
    if (allComplete) {
      await this.completeGoal(goal, goalState);
      return;
    }

    // Get next work item to process
    const nextWorkItem = await this.deps.workItemManager.getNextWorkItem(goalId);
    if (!nextWorkItem) {
      this.debug('No ready work items for goal:', goalId);
      return;
    }

    // Start work item execution
    await this.startWorkItemExecution(nextWorkItem, goal, goalState);
  }

  /**
   * Start executing a work item
   */
  private async startWorkItemExecution(
    workItem: WorkItem,
    goal: Goal,
    goalState: GoalExecutionState
  ): Promise<void> {
    // Set debug context
    debug.setContext({ goalId: goal.id, workItemId: workItem.id });
    debug.custom('scheduler.workitem.starting', 'scheduler', {
      workItemId: workItem.id,
      goalId: goal.id,
      title: workItem.title,
    });

    const modelResult = this.deps.modelSelector.selectModel(workItem, goal);
    const goalSelectedModel = typeof goal.context?.selected_model === 'string'
      ? goal.context.selected_model
      : undefined;
    const workItemSelectedModel = typeof workItem.context?.model === 'string'
      ? workItem.context.model
      : undefined;
    const projectedModel = this.resolveProjectedExecutionModel(
      workItemSelectedModel || goalSelectedModel,
      modelResult.model
    );
    const model = projectedModel.model;
    const modelSource = projectedModel.source;
    const runSelectionProjection = materializeCompatibilitySelectedModelProjection({
      selectedModel: model,
      modelSource,
    });

    // Select lane
    const laneResult = this.deps.laneSelector.selectLane(workItem, goal);
    const laneId = laneResult.laneId;

    debug.custom('scheduler.workitem.assigned', 'scheduler', {
      workItemId: workItem.id,
      model,
      laneId,
    });

    // Check lane capacity
    if (!this.deps.laneSelector.hasCapacity(laneId)) {
      this.debug('Lane at capacity:', laneId);
      debug.clearContext();
      return;
    }

    // Create run
    const existingRuns = this.deps.repository.getRunsByWorkItem(workItem.id);
    const run = this.deps.repository.createRun({
      work_item_id: workItem.id,
      goal_id: goal.id,
      agent_type: workItem.item_type,
      run_sequence: existingRuns.length + 1,
      context: {
        selected_model: runSelectionProjection.selected_model,
        model_source: runSelectionProjection.model_source,
      },
    });

    debug.setContext({ runId: run.id });
    debug.custom('scheduler.run.started', 'scheduler', {
      runId: run.id,
      workItemId: workItem.id,
      goalId: goal.id,
    });

    // Update states
    goalState.status = 'running';
    goalState.currentWorkItemId = workItem.id;
    goalState.currentRunId = run.id;
    if (!goalState.startedAt) {
      goalState.startedAt = Date.now();
    }

    // Track execution context
    const context: WorkItemExecutionContext = {
      workItem,
      goal,
      run,
      laneId,
      model,
      startedAt: Date.now(),
    };
    this.activeExecutions.set(run.id, context);

    // Update lane
    this.deps.laneSelector.incrementActive(laneId);
    this.updateLaneStatus(laneId);

    // Update work item status
    await this.deps.workItemManager.updateStatus(workItem.id, 'in_progress');

    this.emitEvent({
      type: 'work_item_started',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: run.id,
      data: { model, laneId },
    });

    this.emitEvent({
      type: 'run_started',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: run.id,
      data: {
        selected_model: runSelectionProjection.selected_model,
        model_source: runSelectionProjection.model_source,
      },
    });

    this.emitEvent({
      type: 'work_item_in_progress',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: run.id,
      data: { stage: 'execution', progress: 10 },
    });

    // Execute work item (async, don't await)
    this.dispatchExecution(context).catch((error) => {
      this.debug('Execution error:', error);
    });
  }

  /**
   * Dispatch a work item through the configured execution mode
   */
  private async dispatchExecution(context: WorkItemExecutionContext): Promise<void> {
    if (this.config.executionMode === 'evented') {
      await this.publishTaskReady(context);
      return;
    }

    await this.executeWorkItem(context);
  }

  private resolveProjectedExecutionModel(
    compatibilitySelectedModel: string | undefined,
    selectorDefaultModel: string
  ): { model: string; source: 'tui_selected' | 'scheduler_selector' } {
    if (compatibilitySelectedModel) {
      return {
        model: compatibilitySelectedModel,
        source: 'tui_selected',
      };
    }

    // Persisted selected_model/model remain compatibility mirrors. When they
    // are absent, scheduler falls through the explicit authority read path for
    // its selector-derived default without changing current runtime semantics.
    const resolved = resolveEffectiveModelSelection({
      defaultModel: selectorDefaultModel,
    });

    return {
      model: resolved?.model ?? selectorDefaultModel,
      source: 'scheduler_selector',
    };
  }

  private buildExecutionRequest(context: WorkItemExecutionContext): ExecutionRequest {
    const { workItem, goal, run, laneId, model } = context;
    const budgetStatus = this.deps.budgetTracker.getBudgetStatus(goal);

    return {
      runId: run.id,
      goalId: goal.id,
      workItemId: workItem.id,
      workItem,
      model,
      laneId,
      budgetRemaining: budgetStatus,
    };
  }

  private async publishTaskReady(context: WorkItemExecutionContext): Promise<void> {
    const request = this.buildExecutionRequest(context);
    const dispatchedAt = Date.now();
    const eventedDispatch = this.mergeEventedDispatch(
      context.run.context,
      buildEventedDispatchCheckpoint({
        laneId: request.laneId,
        dispatchedAt,
        resultContinuationApplied: false,
      })
    );

    this.deps.repository.mergeRunContext(request.runId, {
      evented_dispatch: eventedDispatch,
    });
    context.run.context = {
      ...(context.run.context ?? {}),
      evented_dispatch: eventedDispatch,
    };

    await this.deps.runtimeEventBus.publish({
      id: randomUUID(),
      type: 'task.ready',
      source: 'scheduler',
      timestamp: dispatchedAt,
      runId: request.runId,
      goalId: request.goalId,
      workItemId: request.workItemId,
      payload: request,
    });
  }

  private mergeEventedDispatch(
    context: WorkItemExecutionContext['run']['context'],
    patch: object
  ): Record<string, unknown> {
    const currentEventedDispatch = context?.evented_dispatch;
    const currentEventedDispatchRecord =
      currentEventedDispatch &&
      typeof currentEventedDispatch === 'object' &&
      !Array.isArray(currentEventedDispatch)
        ? (currentEventedDispatch as Record<string, unknown>)
        : {};

    const patchRecord = Object.fromEntries(
      Object.entries(patch as Record<string, unknown>).filter(([, value]) => value !== undefined)
    );

    return {
      ...currentEventedDispatchRecord,
      ...patchRecord,
    };
  }

  /**
   * Execute a work item
   */
  private async executeWorkItem(context: WorkItemExecutionContext): Promise<void> {
    const { run } = context;

    try {
      // Execute
      const result = await this.deps.executionPort.execute(this.buildExecutionRequest(context));
      await this.continueAfterExecutionResult(context, result);
    } catch (error) {
      const result: ExecutionResult = {
        runId: run.id,
        workItemId: context.workItem.id,
        success: false,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
          recoverable: true,
        },
      };
      await this.continueAfterExecutionResult(context, result);
    }
  }

  private ensureRuntimeEventSubscription(): void {
    if (this.runtimeEventUnsubscribe) {
      return;
    }

    this.runtimeEventUnsubscribe = this.deps.runtimeEventBus.subscribeAll((event) =>
      this.handleRuntimeEvent(event)
    );
  }

  private async handleRuntimeEvent(event: RuntimeEvent): Promise<void> {
    if (this.config.executionMode !== 'evented') {
      return;
    }

    if (event.type === 'execution.completed') {
      await this.handleEventedExecutionCompleted(event);
      return;
    }

    if (event.type === 'execution.failed') {
      await this.handleEventedExecutionFailed(event);
    }
  }

  private async handleEventedExecutionCompleted(event: RuntimeEvent): Promise<void> {
    const context = this.getActiveExecutionContext(event.runId);
    if (!context) {
      this.debugSuppressibleEventedResult(event.runId, 'execution.completed');
      return;
    }

    const result = this.parseExecutionCompletedResult(event);
    if (!result) {
      this.debug('Ignoring execution.completed event without valid result for run:', event.runId);
      return;
    }

    if (!this.tryClaimEventedResultContinuation(context.run.id, 'execution.completed')) {
      return;
    }

    await this.continueAfterExecutionResult(context, result, { cleanupBeforeContinuation: true });
  }

  private async handleEventedExecutionFailed(event: RuntimeEvent): Promise<void> {
    const context = this.getActiveExecutionContext(event.runId);
    if (!context) {
      this.debugSuppressibleEventedResult(event.runId, 'execution.failed');
      return;
    }

    if (!this.tryClaimEventedResultContinuation(context.run.id, 'execution.failed')) {
      return;
    }

    const result = this.parseExecutionFailedResult(event, context);

    await this.continueAfterExecutionResult(context, result, { cleanupBeforeContinuation: true });
  }

  private getActiveExecutionContext(runId?: string): WorkItemExecutionContext | null {
    if (!runId) {
      return null;
    }

    return this.activeExecutions.get(runId) ?? null;
  }

  private parseExecutionCompletedResult(event: RuntimeEvent): ExecutionResult | null {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const candidate = (payload as { result?: unknown }).result;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return null;
    }

    const result = candidate as Partial<ExecutionResult>;
    if (!this.isExecutionResultCandidate(result)) {
      return null;
    }

    return result as ExecutionResult;
  }

  private parseExecutionFailedError(event: RuntimeEvent): ExecutionError {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        code: 'EXECUTION_FAILED',
        message: 'Execution failed without an error payload',
        recoverable: true,
      };
    }

    const candidate = (payload as { error?: unknown }).error;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return {
        code: 'EXECUTION_FAILED',
        message: 'Execution failed without an error payload',
        recoverable: true,
      };
    }

    const error = candidate as Partial<ExecutionError>;
    if (!this.isExecutionErrorCandidate(error)) {
      return {
        code: 'EXECUTION_FAILED',
        message: 'Execution failed without an error payload',
        recoverable: true,
      };
    }

    return error as ExecutionError;
  }

  private parseExecutionFailedResult(
    event: RuntimeEvent,
    context: WorkItemExecutionContext
  ): ExecutionResult {
    const payload = event.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const candidate = (payload as { result?: unknown }).result;
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const failedResult = candidate as Partial<ExecutionResult>;
        if (this.isExecutionResultCandidate(failedResult, false)) {
          return {
            ...failedResult,
            goalId:
              typeof failedResult.goalId === 'string' && failedResult.goalId.length > 0
                ? failedResult.goalId
                : event.goalId ?? context.goal.id,
            source:
              typeof failedResult.source === 'string' && failedResult.source.length > 0
                ? failedResult.source
                : event.source,
            outcome: 'failure',
            error: failedResult.error ?? this.parseExecutionFailedError(event),
          } as ExecutionResult;
        }
      }
    }

    return {
      runId: context.run.id,
      goalId: event.goalId ?? context.goal.id,
      workItemId: context.workItem.id,
      source: event.source,
      success: false,
      outcome: 'failure',
      tokensUsed: 0,
      timeSeconds: 0,
      costUsd: 0,
      artifacts: [],
      error: this.parseExecutionFailedError(event),
    };
  }

  private tryClaimEventedResultContinuation(
    runId: string,
    eventType: 'execution.completed' | 'execution.failed'
  ): boolean {
    const claimedAt = Date.now();
    const claim = this.deps.repository.claimEventedResultContinuation(runId, claimedAt);

    if (claim.status === 'claimed') {
      const context = this.activeExecutions.get(runId);
      if (context?.run.context) {
        context.run.context = claim.run?.context ?? context.run.context;
      } else if (context) {
        context.run.context = claim.run?.context;
      }
      return true;
    }

    if (claim.status === 'already_applied') {
      this.debug(`Suppressing duplicate ${eventType} for run ${runId}: durable continuation already applied`);
      this.cleanupExecutionContext(runId);
      return false;
    }

    if (claim.status === 'suppressed_by_replay') {
      this.debug(
        `Suppressing stale ${eventType} for run ${runId}: durable continuation authority was transferred to a replay run`
      );
      this.cleanupExecutionContext(runId);
      return false;
    }

    if (claim.status === 'already_terminal') {
      this.debug(`Ignoring stale ${eventType} for run ${runId}: durable run state is already terminal`);
      this.cleanupExecutionContext(runId);
      return false;
    }

    if (claim.status === 'missing_evented_dispatch') {
      this.debug(`Ignoring ${eventType} for run ${runId}: durable evented dispatch checkpoint is missing`);
      return false;
    }

    this.debug(`Ignoring ${eventType} for run ${runId}: durable run row no longer exists`);
    return false;
  }

  private debugSuppressibleEventedResult(
    runId: string | undefined,
    eventType: 'execution.completed' | 'execution.failed'
  ): void {
    if (!runId) {
      return;
    }

    const run = this.deps.repository.getRun(runId);
    if (!run) {
      this.debug(`Ignoring ${eventType} for run ${runId}: no active execution context and durable run row was not found`);
      return;
    }

    const checkpoint = readEventedDispatchCheckpoint(run.context);
    if (!checkpoint) {
      this.debug(`Ignoring ${eventType} for run ${runId}: no active execution context and no durable evented dispatch checkpoint`);
      return;
    }

    if (checkpoint.result_continuation_applied) {
      this.debug(`Suppressing duplicate ${eventType} for run ${runId}: durable continuation already applied`);
      return;
    }

    if (
      checkpoint.manual_replay &&
      typeof checkpoint.manual_replay.original_continuation_suppressed_at === 'number'
    ) {
      this.debug(
        `Suppressing stale ${eventType} for run ${runId}: durable continuation authority was transferred to replay run ${checkpoint.manual_replay.replacement_run_id}`
      );
      return;
    }

    if (run.status !== 'running') {
      this.debug(`Ignoring stale ${eventType} for run ${runId}: durable run state is already terminal`);
      return;
    }

    this.debug(`Ignoring ${eventType} for run ${runId}: no active execution context for durable continuation`);
  }

  private isExecutionResultCandidate(
    result: Partial<ExecutionResult>,
    expectedSuccess?: boolean
  ): result is ExecutionResult {
    if (
      typeof result.runId !== 'string' ||
      result.runId.length === 0 ||
      typeof result.workItemId !== 'string' ||
      result.workItemId.length === 0 ||
      typeof result.success !== 'boolean' ||
      typeof result.tokensUsed !== 'number' ||
      typeof result.timeSeconds !== 'number' ||
      typeof result.costUsd !== 'number' ||
      !Array.isArray(result.artifacts)
    ) {
      return false;
    }

    if (expectedSuccess !== undefined && result.success !== expectedSuccess) {
      return false;
    }

    if (
      (result.goalId !== undefined && (typeof result.goalId !== 'string' || result.goalId.length === 0)) ||
      (result.source !== undefined && (typeof result.source !== 'string' || result.source.length === 0)) ||
      (result.actualModel !== undefined &&
        (typeof result.actualModel !== 'string' || result.actualModel.length === 0)) ||
      (result.endpointId !== undefined &&
        (typeof result.endpointId !== 'string' || result.endpointId.length === 0)) ||
      (result.outcome !== undefined && result.outcome !== 'success' && result.outcome !== 'failure') ||
      (result.error !== undefined && !this.isExecutionErrorCandidate(result.error))
    ) {
      return false;
    }

    return true;
  }

  private isExecutionErrorCandidate(error: Partial<ExecutionError>): error is ExecutionError {
    return (
      typeof error.code === 'string' &&
      error.code.length > 0 &&
      typeof error.message === 'string' &&
      error.message.length > 0 &&
      typeof error.recoverable === 'boolean'
    );
  }

  private async continueAfterExecutionResult(
    context: WorkItemExecutionContext,
    result: ExecutionResult,
    options: { cleanupBeforeContinuation?: boolean } = {}
  ): Promise<void> {
    const { workItem, goal, run, model } = context;

    try {
      await this.deps.budgetTracker.recordUsage(
        goal.id,
        result.tokensUsed,
        result.timeSeconds / 60,
        result.costUsd
      );

      const existingCheckpoint = readEventedDispatchCheckpoint(run.context);
      const resultContinuationAppliedAt =
        existingCheckpoint?.result_continuation_applied_at ?? Date.now();
      const completedEventedDispatch = existingCheckpoint
        ? this.mergeEventedDispatch(
            run.context,
            buildEventedDispatchCheckpoint({
              laneId: existingCheckpoint.lane_id,
              dispatchedAt: existingCheckpoint.dispatched_at,
              resultContinuationApplied: true,
              resultContinuationAppliedAt,
            })
          )
        : null;
      const runCompletionProjection = materializeCompatibilityRunModelProjection({
        selectedModel: model,
        actualModel: result.actualModel ?? model,
      });

      this.deps.repository.completeRun(run.id, {
        status: result.success ? 'success' : 'failure',
        tokens_used: result.tokensUsed,
        time_seconds: result.timeSeconds,
        cost_usd: result.costUsd,
        artifacts: result.artifacts,
        error_message: result.error?.message,
        context: {
          selected_model: runCompletionProjection.selected_model,
          actual_model: runCompletionProjection.actual_model,
          endpoint_id: result.endpointId,
          ...(completedEventedDispatch ? { evented_dispatch: completedEventedDispatch } : {}),
        },
      });
      if (completedEventedDispatch) {
        run.context = {
          ...(run.context ?? {}),
          evented_dispatch: completedEventedDispatch,
        };
      }

      this.emitEvent({
        type: 'run_completed',
        timestamp: Date.now(),
        goalId: goal.id,
        workItemId: workItem.id,
        runId: run.id,
        data: {
          success: result.success,
          selected_model: runCompletionProjection.selected_model,
          actual_model: runCompletionProjection.actual_model,
          endpoint_id: result.endpointId,
        },
      });

      this.metrics.totalRunsExecuted++;

      if (options.cleanupBeforeContinuation) {
        this.cleanupExecutionContext(run.id);
      }

      if (result.success) {
        await this.handleExecutionSuccess(context);
        return;
      }

      await this.handleExecutionFailure(context, result.error ?? {
        code: 'EXECUTION_FAILED',
        message: 'Execution failed without an error payload',
        recoverable: true,
      });
    } finally {
      if (!options.cleanupBeforeContinuation) {
        this.cleanupExecutionContext(run.id);
      }
    }
  }

  private cleanupExecutionContext(runId: string): void {
    const context = this.activeExecutions.get(runId);
    if (!context) {
      return;
    }

    this.activeExecutions.delete(runId);
    this.deps.laneSelector.decrementActive(context.laneId);
    this.updateLaneStatus(context.laneId);
  }

  /**
   * Handle successful execution
   */
  private async handleExecutionSuccess(context: WorkItemExecutionContext): Promise<void> {
    const { workItem, goal, run } = context;

    debug.setContext({ goalId: goal.id, workItemId: workItem.id, runId: run.id });
    debug.custom('scheduler.workitem.success', 'scheduler', {
      workItemId: workItem.id,
      runId: run.id,
    });

    // Update work item to verify status
    await this.deps.workItemManager.updateStatus(workItem.id, 'verify');

    // Run verification
    this.emitEvent({
      type: 'verification_started',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: run.id,
    });

    this.emitEvent({
      type: 'work_item_in_progress',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: run.id,
      data: { stage: 'verification', progress: 75 },
    });

    debug.custom('scheduler.verification.started', 'scheduler', {
      workItemId: workItem.id,
      runId: run.id,
    });

    const verificationResult = await this.deps.qualityGateRunner.runVerification(workItem, run);

    debug.custom('scheduler.verification.completed', 'scheduler', {
      workItemId: workItem.id,
      runId: run.id,
      passed: verificationResult.requiredPassed,
    });

    this.emitEvent({
      type: 'verification_completed',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: run.id,
      data: { passed: verificationResult.requiredPassed, summary: verificationResult.summary },
    });

    if (verificationResult.requiredPassed) {
      // Mark work item as done
      await this.deps.workItemManager.updateStatus(workItem.id, 'done');
      this.metrics.totalWorkItemsCompleted++;

      this.emitEvent({
        type: 'work_item_completed',
        timestamp: Date.now(),
        goalId: goal.id,
        workItemId: workItem.id,
      });

      this.emitEvent({
        type: 'work_item_ended',
        timestamp: Date.now(),
        goalId: goal.id,
        workItemId: workItem.id,
        runId: run.id,
        data: { outcome: 'success', progress: 100 },
      });

      // Update average duration
      const duration = Date.now() - context.startedAt;
      this.updateAverageDuration(duration);
    } else {
      // Verification failed, treat as execution failure
      const error = {
        code: 'VERIFICATION_FAILED',
        message: verificationResult.summary,
        recoverable: true,
      };
      await this.handleExecutionFailure(context, error);
    }
  }

  /**
   * Handle execution failure
   */
  private async handleExecutionFailure(
    context: WorkItemExecutionContext,
    error: { code: string; message: string; recoverable: boolean }
  ): Promise<void> {
    const { workItem, goal } = context;

    this.emitEvent({
      type: 'work_item_ended',
      timestamp: Date.now(),
      goalId: goal.id,
      workItemId: workItem.id,
      runId: context.run.id,
      data: { outcome: 'failure', error, progress: 100 },
    });

    // Decide retry strategy
    const retryDecision = this.deps.retryHandler.decideRetry(workItem, error, {});

    if (retryDecision.shouldRetry) {
      this.debug('Retrying work item:', workItem.id, 'strategy:', retryDecision.strategy);

      if (retryDecision.strategy === 'escalate') {
        // Create escalation
        await this.deps.escalationHandler.createEscalation({
          workItemId: workItem.id,
          goalId: goal.id,
          type: 'error_recovery',
          severity: 'high',
          title: `Execution failed: ${error.code}`,
          description: error.message,
        });

        this.emitEvent({
          type: 'escalation_created',
          timestamp: Date.now(),
          goalId: goal.id,
          workItemId: workItem.id,
          data: { type: 'error_recovery', error },
        });

        // Mark work item as blocked
        await this.deps.workItemManager.updateStatus(workItem.id, 'blocked');
      } else {
        // Queue for retry
        await this.deps.workItemManager.updateStatus(workItem.id, 'queued');
        this.deps.repository.updateWorkItemStatus(workItem.id, 'queued');
      }
    } else {
      // No retry, mark as failed
      await this.deps.workItemManager.updateStatus(workItem.id, 'failed');

      this.emitEvent({
        type: 'work_item_failed',
        timestamp: Date.now(),
        goalId: goal.id,
        workItemId: workItem.id,
        data: { error },
      });

      // Check if goal should fail
      const goalState = this.goalStates.get(goal.id);
      if (goalState) {
        goalState.status = 'failed';
        goalState.error = error.message;
        goalState.completedAt = Date.now();
        this.deps.repository.updateGoalStatus(goal.id, 'blocked');

        this.emitEvent({
          type: 'goal_failed',
          timestamp: Date.now(),
          goalId: goal.id,
          data: { error },
        });
      }
    }
  }

  /**
   * Handle budget exceeded
   */
  private async handleBudgetExceeded(goal: Goal, goalState: GoalExecutionState): Promise<void> {
    // Create escalation
    await this.deps.escalationHandler.createEscalation({
      workItemId: goalState.currentWorkItemId || '',
      goalId: goal.id,
      type: 'budget_exceeded',
      severity: 'critical',
      title: 'Budget exceeded',
      description: `Goal ${goal.id} has exceeded its budget limits`,
    });

    this.emitEvent({
      type: 'budget_exceeded',
      timestamp: Date.now(),
      goalId: goal.id,
    });

    goalState.status = 'paused';
  }

  /**
   * Complete a goal
   */
  private async completeGoal(goal: Goal, goalState: GoalExecutionState): Promise<void> {
    goalState.status = 'completed';
    goalState.completedAt = Date.now();

    this.deps.repository.updateGoalStatus(goal.id, 'completed');
    this.metrics.totalGoalsProcessed++;

    this.emitEvent({
      type: 'goal_completed',
      timestamp: Date.now(),
      goalId: goal.id,
    });

    this.debug('Goal completed:', goal.id);
  }

  /**
   * Clean up completed goals from active list
   */
  private cleanupCompletedGoals(): void {
    const terminalStatuses: GoalExecutionState['status'][] = [
      'completed',
      'failed',
      'cancelled',
    ];

    this.state.activeGoals = this.state.activeGoals.filter((goalId) => {
      const state = this.goalStates.get(goalId);
      return state && !terminalStatuses.includes(state.status);
    });
  }

  /**
   * Update lane status in state
   */
  private updateLaneStatus(laneId: LaneId): void {
    const hasCapacity = this.deps.laneSelector.hasCapacity(laneId);
    this.state.lanes[laneId].isAvailable = hasCapacity;
  }

  /**
   * Update average work item duration
   */
  private updateAverageDuration(newDuration: number): void {
    const total = this.metrics.totalWorkItemsCompleted;
    if (total === 0) {
      this.metrics.averageWorkItemDurationMs = newDuration;
    } else {
      // Running average
      this.metrics.averageWorkItemDurationMs =
        (this.metrics.averageWorkItemDurationMs * (total - 1) + newDuration) / total;
    }
  }

  /**
   * Emit an event to all handlers
   */
  private emitEvent(event: SchedulerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((error) => {
            this.debug('Event handler error:', error);
          });
        }
      } catch (error) {
        this.debug('Event handler error:', error);
      }
    }
  }

  /**
   * Debug logging
   */
  private debug(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[Scheduler]', ...args);
    }
  }
}
