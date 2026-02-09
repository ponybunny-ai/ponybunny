/**
 * Scheduler Core Implementation
 *
 * The main orchestrator that coordinates all scheduler components
 * to execute goals through the 8-phase lifecycle.
 */

import type { Goal, WorkItem } from '../../work-order/types/index.js';
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

const DEFAULT_CONFIG: SchedulerConfig = {
  tickIntervalMs: 1000,
  maxConcurrentGoals: 5,
  autoStart: false,
  debug: false,
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

  constructor(deps: SchedulerDependencies, config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.deps = deps;
    this.state = this.createInitialState();
    this.metrics = this.createInitialMetrics();
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

  async start(): Promise<void> {
    if (this.state.status === 'running') {
      return;
    }

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
        await this.deps.executionEngine.abort(runId);
      } catch (error) {
        this.debug('Error aborting execution:', runId, error);
      }
    }
    this.activeExecutions.clear();

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
          await this.deps.executionEngine.abort(runId);
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

    // Select model
    const modelResult = this.deps.modelSelector.selectModel(workItem, goal);
    const model = modelResult.model;

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
    });

    // Execute work item (async, don't await)
    this.executeWorkItem(context).catch((error) => {
      this.debug('Execution error:', error);
    });
  }

  /**
   * Execute a work item
   */
  private async executeWorkItem(context: WorkItemExecutionContext): Promise<void> {
    const { workItem, goal, run, laneId, model } = context;

    try {
      // Get budget info
      const budgetStatus = this.deps.budgetTracker.getBudgetStatus(goal);

      // Execute
      const result = await this.deps.executionEngine.execute(workItem, {
        model,
        laneId,
        budgetRemaining: budgetStatus,
      });

      // Record usage
      await this.deps.budgetTracker.recordUsage(
        goal.id,
        result.tokensUsed,
        result.timeSeconds / 60,
        result.costUsd
      );

      // Complete run
      this.deps.repository.completeRun(run.id, {
        status: result.success ? 'success' : 'failure',
        tokens_used: result.tokensUsed,
        time_seconds: result.timeSeconds,
        cost_usd: result.costUsd,
        artifacts: result.artifacts,
        error_message: result.error?.message,
      });

      this.emitEvent({
        type: 'run_completed',
        timestamp: Date.now(),
        goalId: goal.id,
        workItemId: workItem.id,
        runId: run.id,
        data: { success: result.success },
      });

      this.metrics.totalRunsExecuted++;

      if (result.success) {
        await this.handleExecutionSuccess(context);
      } else {
        await this.handleExecutionFailure(context, result.error!);
      }
    } catch (error) {
      const execError = {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      };
      await this.handleExecutionFailure(context, execError);
    } finally {
      // Clean up
      this.activeExecutions.delete(run.id);
      this.deps.laneSelector.decrementActive(laneId);
      this.updateLaneStatus(laneId);
    }
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
