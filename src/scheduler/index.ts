/**
 * Scheduler Module
 *
 * The Scheduler is the core brain of PonyBunny, responsible for:
 * - Task orchestration and execution
 * - Model selection based on task complexity
 * - Lane assignment for concurrent execution
 * - Budget tracking and enforcement
 * - Retry handling and error recovery
 */

// Core types
export type {
  LaneId,
  LaneConfig,
  LaneStatus,
  SchedulerStatus,
  SchedulerState,
  ExecutionContext,
  ExecutionResult,
  ExecutionError,
  BudgetInfo,
  BudgetCheckResult,
  BudgetViolation,
  QualityGateResult,
  VerificationResult,
  RetryStrategy,
  RetryDecision,
  SchedulerEventType,
  SchedulerEvent,
  SchedulerEventHandler,
  IScheduler,
  ILaneSelector,
  IWorkItemManager,
  IExecutionEngine,
  IQualityGateRunner,
  IBudgetTracker,
  IRetryHandler,
  IEscalationHandler,
} from './types.js';

// Model Selector
export type {
  ModelTier,
  ComplexityScore,
  ComplexityFactor,
  ModelTierConfig,
  ModelConfig,
  ModelSelectionResult,
  IModelSelector,
  IComplexityScorer,
} from './model-selector/index.js';

export {
  ComplexityScorer,
  ModelSelector,
  DEFAULT_MODEL_TIER_CONFIG,
  loadModelTierConfig,
} from './model-selector/index.js';

// Lane Selector
export type {
  ILaneSelector as ILaneSelectorImpl,
  LaneSelectorConfig,
  LaneSelectionResult,
} from './lane-selector/index.js';

export {
  LaneSelector,
  DEFAULT_LANE_CONFIGS,
  getLaneConfig,
  getAllLaneIds,
} from './lane-selector/index.js';

// Budget Tracker
export type {
  IBudgetTracker as IBudgetTrackerImpl,
  BudgetTrackerConfig,
  BudgetWarningThresholds,
  BudgetWarningLevel,
  BudgetStatus,
} from './budget-tracker/index.js';

export { BudgetTracker } from './budget-tracker/index.js';

// Retry Handler
export type {
  IRetryHandler as IRetryHandlerImpl,
  RetryConfig,
  ErrorPattern,
} from './retry-handler/index.js';

export { RetryHandler } from './retry-handler/index.js';

// Work Item Manager
export type {
  IWorkItemManager as IWorkItemManagerImpl,
  IWorkItemRepository,
  DAGValidationResult,
  DependencyStatus,
  WorkItemTransition,
} from './work-item-manager/index.js';

export { WorkItemManager } from './work-item-manager/index.js';

// Escalation Handler
export type {
  IEscalationHandler as IEscalationHandlerImpl,
  IEscalationRepository,
  EscalationCreateParams,
  EscalationResolveParams,
  EscalationFilter,
  EscalationStats,
} from './escalation-handler/index.js';

export { EscalationHandler } from './escalation-handler/index.js';

// Quality Gate Runner
export type {
  IQualityGateRunner as IQualityGateRunnerImpl,
  ICommandExecutor,
  ILLMReviewer,
  QualityGateResult as QualityGateResultImpl,
  VerificationResult as VerificationResultImpl,
  QualityGateRunnerConfig,
} from './quality-gate-runner/index.js';

export {
  QualityGateRunner,
  DefaultCommandExecutor,
  MockLLMReviewer,
} from './quality-gate-runner/index.js';
