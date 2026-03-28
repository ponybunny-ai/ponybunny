/**
 * GoalHarness Interface — ADR-001
 *
 * Defines the contract for the GoalHarness composition layer.
 * GoalHarness owns pre-execution lifecycle (elaboration, knowledge injection, planning).
 * SchedulerCore owns execution and all production infrastructure.
 */

import type { Goal, SuccessCriterion } from '../work-order/types/index.js';

export interface GoalSubmission {
  title: string;
  description: string;
  success_criteria: SuccessCriterion[];
  priority?: number;
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
  context?: Record<string, unknown>;
}

export interface GoalHarnessResult {
  goal: Goal;
  elaborationApplied: boolean;
  planGenerated: boolean;
  workItemCount: number;
  escalations: string[];
  delegatedToScheduler: boolean;
}

export interface IGoalHarness {
  /** Create a new goal, elaborate, plan, and delegate to SchedulerCore. */
  submitGoal(submission: GoalSubmission): Promise<GoalHarnessResult>;

  /** Elaborate, plan, and delegate an existing queued goal. Used by HarnessDaemon. */
  processQueuedGoal(goalId: string): Promise<GoalHarnessResult>;

  /** Cancel a goal via SchedulerCore. */
  cancelGoal(goalId: string): Promise<void>;
}
