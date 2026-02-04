/**
 * Scheduler Core Types
 */

import type { Goal, WorkItem, Run, Escalation } from '../work-order/types/index.js';

// ============================================================================
// Execution Lanes
// ============================================================================

export type LaneId = 'main' | 'subagent' | 'cron' | 'session';

export interface LaneConfig {
  id: LaneId;
  displayName: string;
  description: string;
  /** Maximum concurrent executions in this lane */
  maxConcurrency: number;
  /** Default priority for work items in this lane */
  defaultPriority: number;
}

export interface LaneStatus {
  laneId: LaneId;
  activeCount: number;
  queuedCount: number;
  isAvailable: boolean;
}

// ============================================================================
// Scheduler State
// ============================================================================

export type SchedulerStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'stopped';

export interface SchedulerState {
  status: SchedulerStatus;
  activeGoals: string[];
  lanes: Record<LaneId, LaneStatus>;
  lastTickAt?: number;
  errorCount: number;
}

// ============================================================================
// Work Item Execution
// ============================================================================

export interface ExecutionContext {
  goalId: string;
  workItemId: string;
  runId: string;
  laneId: LaneId;
  model: string;
  startedAt: number;
  budgetRemaining: BudgetInfo;
}

export interface ExecutionResult {
  success: boolean;
  runId: string;
  status: Run['status'];
  tokensUsed: number;
  timeSeconds: number;
  costUsd: number;
  artifacts: string[];
  error?: ExecutionError;
}

export interface ExecutionError {
  code: string;
  message: string;
  signature?: string;
  recoverable: boolean;
  suggestedAction?: 'retry' | 'switch_model' | 'escalate';
}

// ============================================================================
// Budget Management
// ============================================================================

export interface BudgetInfo {
  tokens: {
    limit?: number;
    spent: number;
    remaining?: number;
  };
  time: {
    limitMinutes?: number;
    spentMinutes: number;
    remainingMinutes?: number;
  };
  cost: {
    limitUsd?: number;
    spentUsd: number;
    remainingUsd?: number;
  };
}

export interface BudgetCheckResult {
  withinBudget: boolean;
  violations: BudgetViolation[];
}

export interface BudgetViolation {
  type: 'tokens' | 'time' | 'cost';
  limit: number;
  current: number;
  overage: number;
}

// ============================================================================
// Quality Gates
// ============================================================================

export interface QualityGateResult {
  gateName: string;
  passed: boolean;
  required: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface VerificationResult {
  workItemId: string;
  allPassed: boolean;
  requiredPassed: boolean;
  results: QualityGateResult[];
  summary: string;
}

// ============================================================================
// Retry Strategy
// ============================================================================

export type RetryStrategy = 'same_model' | 'switch_model' | 'escalate';

export interface RetryDecision {
  shouldRetry: boolean;
  strategy: RetryStrategy;
  reason: string;
  nextModel?: string;
  delayMs?: number;
}

// ============================================================================
// Scheduler Events
// ============================================================================

export type SchedulerEventType =
  | 'goal_started'
  | 'goal_completed'
  | 'goal_failed'
  | 'work_item_started'
  | 'work_item_completed'
  | 'work_item_failed'
  | 'run_started'
  | 'run_completed'
  | 'verification_started'
  | 'verification_completed'
  | 'escalation_created'
  | 'escalation_resolved'
  | 'budget_warning'
  | 'budget_exceeded';

export interface SchedulerEvent {
  type: SchedulerEventType;
  timestamp: number;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  data?: Record<string, unknown>;
}

export type SchedulerEventHandler = (event: SchedulerEvent) => void | Promise<void>;

// ============================================================================
// Scheduler Interfaces
// ============================================================================

export interface IScheduler {
  /** Get current scheduler state */
  getState(): SchedulerState;

  /** Start processing goals */
  start(): Promise<void>;

  /** Pause processing (finish current work items) */
  pause(): Promise<void>;

  /** Resume processing */
  resume(): Promise<void>;

  /** Stop scheduler (abort current work items) */
  stop(): Promise<void>;

  /** Submit a new goal for processing */
  submitGoal(goal: Goal): Promise<void>;

  /** Cancel a goal */
  cancelGoal(goalId: string): Promise<void>;

  /** Subscribe to scheduler events */
  on(handler: SchedulerEventHandler): void;

  /** Unsubscribe from scheduler events */
  off(handler: SchedulerEventHandler): void;
}

export interface ILaneSelector {
  /** Select appropriate lane for a work item */
  selectLane(workItem: WorkItem, goal: Goal): LaneId;

  /** Get lane configuration */
  getLaneConfig(laneId: LaneId): LaneConfig;

  /** Get all lane statuses */
  getLaneStatuses(): Record<LaneId, LaneStatus>;

  /** Check if lane has capacity */
  hasCapacity(laneId: LaneId): boolean;
}

export interface IWorkItemManager {
  /** Get next work items ready for execution */
  getReadyWorkItems(goalId: string): Promise<WorkItem[]>;

  /** Check if work item dependencies are satisfied */
  areDependenciesSatisfied(workItem: WorkItem): Promise<boolean>;

  /** Update work item status with validation */
  updateStatus(workItemId: string, status: WorkItem['status']): Promise<void>;

  /** Get blocked work items */
  getBlockedWorkItems(goalId: string): Promise<WorkItem[]>;

  /** Validate DAG integrity */
  validateDAG(goalId: string): Promise<{ valid: boolean; errors: string[] }>;
}

export interface IExecutionEngine {
  /** Execute a work item */
  execute(workItem: WorkItem, context: ExecutionContext): Promise<ExecutionResult>;

  /** Abort a running execution */
  abort(runId: string): Promise<void>;

  /** Get active executions */
  getActiveExecutions(): ExecutionContext[];
}

export interface IQualityGateRunner {
  /** Run verification plan for a work item */
  runVerification(workItem: WorkItem, run: Run): Promise<VerificationResult>;

  /** Run a single quality gate */
  runGate(gate: WorkItem['verification_plan'] extends { quality_gates: infer G } ? G extends (infer T)[] ? T : never : never): Promise<QualityGateResult>;
}

export interface IBudgetTracker {
  /** Check if goal is within budget */
  checkBudget(goal: Goal): BudgetCheckResult;

  /** Get remaining budget info */
  getRemainingBudget(goal: Goal): BudgetInfo;

  /** Record resource usage */
  recordUsage(goalId: string, tokens: number, timeSeconds: number, costUsd: number): Promise<void>;
}

export interface IRetryHandler {
  /** Decide retry strategy based on error */
  decideRetry(workItem: WorkItem, error: ExecutionError, run: Run): RetryDecision;

  /** Get retry delay based on attempt count */
  getRetryDelay(attemptCount: number): number;
}

export interface IEscalationHandler {
  /** Create an escalation */
  createEscalation(
    workItem: WorkItem,
    type: Escalation['escalation_type'],
    reason: string,
    context?: Escalation['context_data']
  ): Promise<Escalation>;

  /** Resolve an escalation */
  resolveEscalation(
    escalationId: string,
    action: Escalation['resolution_action'],
    data?: Record<string, unknown>
  ): Promise<void>;

  /** Get pending escalations for a goal */
  getPendingEscalations(goalId: string): Promise<Escalation[]>;
}
