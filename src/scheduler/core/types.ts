/**
 * Scheduler Core Types
 */

import type { Goal, WorkItem, Run, InFlightRunReconciliationCandidate } from '../../work-order/types/index.js';
import type {
  EventedManualReplayPrecheckResult,
  EventedManualReplayStartResult,
  EventedResultContinuationClaim,
} from '../../infra/persistence/repository-interface.js';
import type { LaneId, SchedulerState, SchedulerEvent, SchedulerEventHandler } from '../types.js';
import type { ModelSelectionResult } from '../model-selector/index.js';
import type { LaneSelectionResult } from '../lane-selector/index.js';
import type { BudgetStatus } from '../budget-tracker/index.js';
import type { VerificationResult } from '../quality-gate-runner/index.js';
import type { ExecutionPort } from '../../runtime/execution-boundary/index.js';
import type { EventBus as RuntimeEventBus } from '../../runtime/event-bus/index.js';

export type SchedulerExecutionMode = 'direct' | 'evented';

export interface SchedulerConfig {
  /** Interval between scheduler ticks in ms */
  tickIntervalMs: number;
  /** Maximum goals to process concurrently */
  maxConcurrentGoals: number;
  /** Whether to auto-start on goal submission */
  autoStart: boolean;
  /** Enable debug logging */
  debug: boolean;
  executionMode: SchedulerExecutionMode;
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

export interface SchedulerRuntimeRolloutConfig {
  deterministicRuntimeEnabled: boolean;
  planCompilerEnabled: boolean;
  toolRoutingMode: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  runtimeRollout: SchedulerConfig['runtimeRollout'];
}

export interface GoalExecutionState {
  goalId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentWorkItemId?: string;
  currentRunId?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface WorkItemExecutionContext {
  workItem: WorkItem;
  goal: Goal;
  run: Run;
  laneId: LaneId;
  model: string;
  startedAt: number;
}

export interface SchedulerMetrics {
  totalGoalsProcessed: number;
  totalWorkItemsCompleted: number;
  totalRunsExecuted: number;
  averageWorkItemDurationMs: number;
  successRate: number;
  currentActiveGoals: number;
  currentActiveWorkItems: number;
}

export interface ISchedulerCore {
  /** Get current scheduler state */
  getState(): SchedulerState;

  /** Start the scheduler */
  start(): Promise<void>;

  /** Pause the scheduler (finish current work) */
  pause(): Promise<void>;

  /** Resume the scheduler */
  resume(): Promise<void>;

  /** Stop the scheduler (abort current work) */
  stop(): Promise<void>;

  /** Submit a goal for processing */
  submitGoal(goal: Goal): Promise<void>;

  /** Cancel a goal */
  cancelGoal(goalId: string): Promise<void>;

  /** Get goal execution state */
  getGoalState(goalId: string): GoalExecutionState | undefined;

  /** Get all goal states */
  getAllGoalStates(): GoalExecutionState[];

  /** Get scheduler metrics */
  getMetrics(): SchedulerMetrics;

  /** Subscribe to scheduler events */
  on(handler: SchedulerEventHandler): void;

  /** Unsubscribe from scheduler events */
  off(handler: SchedulerEventHandler): void;

  /** Process a single tick (for testing) */
  tick(): Promise<void>;

  applyRuntimeRollout(config: SchedulerRuntimeRolloutConfig): void;
}

export interface SchedulerDependencies {
  /** Repository for goals and work items */
  repository: ISchedulerRepository;
  /** Model selector for choosing LLM models */
  modelSelector: IModelSelectorAdapter;
  /** Lane selector for execution lanes */
  laneSelector: ILaneSelectorAdapter;
  /** Budget tracker for resource management */
  budgetTracker: IBudgetTrackerAdapter;
  /** Retry handler for error recovery */
  retryHandler: IRetryHandlerAdapter;
  /** Escalation handler for human intervention */
  escalationHandler: IEscalationHandlerAdapter;
  /** Quality gate runner for verification */
  qualityGateRunner: IQualityGateRunnerAdapter;
  /** Work item manager for dependency tracking */
  workItemManager: IWorkItemManagerAdapter;
  /** Execution boundary for running work items */
  executionPort: ExecutionPort;
  /** Runtime event bus used for evented execution handoff */
  runtimeEventBus: RuntimeEventBus;
}

// Adapter interfaces to decouple from concrete implementations

export interface ISchedulerRepository {
  getGoal(id: string): Goal | undefined;
  updateGoalStatus(id: string, status: Goal['status']): void;
  getWorkItemsForGoal(goalId: string): WorkItem[];
  getWorkItem(id: string): WorkItem | undefined;
  updateWorkItemStatus(id: string, status: WorkItem['status']): void;
  createRun(params: {
    work_item_id: string;
    goal_id: string;
    agent_type: string;
    run_sequence: number;
    context?: Record<string, unknown>;
  }): Run;
  getRun(id: string): Run | undefined;
  precheckEventedManualReplay(id: string): EventedManualReplayPrecheckResult;
  mergeRunContext(id: string, contextPatch: Record<string, unknown>): void;
  claimEventedResultContinuation(id: string, appliedAt?: number): EventedResultContinuationClaim;
  startEventedManualReplay(
    id: string,
    params?: {
      requestedAt?: number;
      requestedReason?: 'manual_operator_request';
    }
  ): EventedManualReplayStartResult;
  completeRun(id: string, params: {
    status: Run['status'];
    tokens_used: number;
    time_seconds: number;
    cost_usd: number;
    artifacts: string[];
    error_message?: string;
    context?: Record<string, unknown>;
  }): void;
  getRunsByWorkItem(workItemId: string): Run[];
  listInFlightRunReconciliationCandidates(): InFlightRunReconciliationCandidate[];
}

export interface IModelSelectorAdapter {
  selectModel(workItem: WorkItem, goal: Goal): ModelSelectionResult;
}

export interface ILaneSelectorAdapter {
  selectLane(workItem: WorkItem, goal: Goal): LaneSelectionResult;
  hasCapacity(laneId: LaneId): boolean;
  incrementActive(laneId: LaneId): void;
  decrementActive(laneId: LaneId): void;
}

export interface IBudgetTrackerAdapter {
  getBudgetStatus(goal: Goal): BudgetStatus;
  willExceedBudget(goal: Goal, estimatedTokens: number, estimatedCost: number): boolean;
  recordUsage(goalId: string, tokens: number, timeMinutes: number, costUsd: number): Promise<void>;
}

export interface IRetryHandlerAdapter {
  decideRetry(
    workItem: WorkItem,
    error: { code: string; message: string; recoverable: boolean },
    context: Record<string, unknown>
  ): { shouldRetry: boolean; strategy: string; reason: string; delayMs?: number };
}

export interface IEscalationHandlerAdapter {
  hasBlockingEscalations(goalId: string): Promise<boolean>;
  createEscalation(params: {
    workItemId: string;
    goalId: string;
    type: string;
    severity: string;
    title: string;
    description: string;
  }): Promise<unknown>;
}

export interface IQualityGateRunnerAdapter {
  runVerification(workItem: WorkItem, run: Run): Promise<VerificationResult>;
}

export interface IWorkItemManagerAdapter {
  getNextWorkItem(goalId: string): Promise<WorkItem | null>;
  getReadyWorkItems(goalId: string): Promise<WorkItem[]>;
  areAllWorkItemsComplete(goalId: string): Promise<boolean>;
  updateStatus(workItemId: string, status: WorkItem['status']): Promise<void>;
  areDependenciesSatisfied(workItem: WorkItem): Promise<boolean>;
}
