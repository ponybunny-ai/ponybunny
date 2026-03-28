/**
 * Harness module — ADR-001
 *
 * GoalHarness composition layer over SchedulerCore.
 */

export type {
  GoalSubmission,
  GoalHarnessResult,
  IGoalHarness,
} from './goal-harness-interface.js';

export { GoalHarness } from './goal-harness.js';
export type { GoalHarnessDependencies } from './goal-harness.js';

export { HarnessDaemon } from './harness-daemon.js';
export type { HarnessDaemonConfig } from './harness-daemon.js';

export { PostGoalEvaluator } from './post-goal-evaluator.js';
export type {
  PostGoalEvaluatorDependencies,
  WorkItemEvaluation,
  GoalEvaluationReport,
} from './post-goal-evaluator.js';
