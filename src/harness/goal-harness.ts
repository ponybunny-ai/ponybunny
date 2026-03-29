/**
 * GoalHarness — ADR-001 Implementation
 *
 * Composes over SchedulerCore to provide the complete goal lifecycle:
 *   submitGoal: create goal record → elaborate → plan → delegate
 *   processQueuedGoal: elaborate → plan → delegate (existing goal)
 *
 * GoalHarness is stateless — no polling, no timers, no internal scheduling.
 * Polling responsibility belongs to the caller (HarnessDaemon or gateway handler).
 */

import type { Goal } from '../work-order/types/index.js';
import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IElaborationService, IPlanningService } from '../app/lifecycle/stage-interfaces.js';
import type { ISchedulerCore } from '../scheduler/core/types.js';
import type { IGoalHarness, GoalSubmission, GoalHarnessResult } from './goal-harness-interface.js';
import type { ILogger } from '../infra/observability/logger.js';
import { NoopLogger } from '../infra/observability/logger.js';

export interface GoalHarnessDependencies {
  repository: IWorkOrderRepository;
  elaborationService: IElaborationService;
  planningService: IPlanningService;
  schedulerCore: ISchedulerCore;
  logger?: ILogger;
}

export class GoalHarness implements IGoalHarness {
  private readonly repository: IWorkOrderRepository;
  private readonly elaborationService: IElaborationService;
  private readonly planningService: IPlanningService;
  private readonly schedulerCore: ISchedulerCore;
  private readonly logger: ILogger;

  constructor(deps: GoalHarnessDependencies) {
    this.repository = deps.repository;
    this.elaborationService = deps.elaborationService;
    this.planningService = deps.planningService;
    this.schedulerCore = deps.schedulerCore;
    this.logger = deps.logger ?? new NoopLogger();
  }

  async submitGoal(submission: GoalSubmission): Promise<GoalHarnessResult> {
    // Step 1: Create goal record in repository
    const goal = this.repository.createGoal({
      title: submission.title,
      description: submission.description,
      success_criteria: submission.success_criteria,
      priority: submission.priority,
      budget_tokens: submission.budget_tokens,
      budget_time_minutes: submission.budget_time_minutes,
      budget_cost_usd: submission.budget_cost_usd,
      context: submission.context,
    });

    this.logger.info({ goalId: goal.id, event: 'goal_created' }, `Created goal: ${goal.title} (${goal.id})`);

    // Steps 2-6: elaborate → plan → delegate
    return this.elaboratePlanDelegate(goal);
  }

  async processQueuedGoal(goalId: string): Promise<GoalHarnessResult> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) {
      throw new Error(`[GoalHarness] Goal not found: ${goalId}`);
    }

    if (goal.status !== 'queued') {
      throw new Error(
        `[GoalHarness] Goal ${goalId} is not queued (status: ${goal.status})`
      );
    }

    this.logger.info({ goalId: goal.id, event: 'processing_queued_goal' }, `Processing queued goal: ${goal.title} (${goal.id})`);

    return this.elaboratePlanDelegate(goal);
  }

  async approvePlan(goalId: string): Promise<void> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) {
      throw new Error(`[GoalHarness] Goal not found: ${goalId}`);
    }
    if (goal.status !== 'plan_review') {
      throw new Error(
        `[GoalHarness] Goal ${goalId} is not in plan_review (status: ${goal.status})`
      );
    }

    this.repository.updateGoalStatus(goalId, 'active');
    this.logger.info({ goalId, event: 'plan_approved' }, `Plan approved for goal ${goalId} — delegating to SchedulerCore`);
    await this.schedulerCore.submitGoal(goal);
  }

  async cancelGoal(goalId: string): Promise<void> {
    this.logger.info({ goalId, event: 'goal_cancelling' }, `Cancelling goal: ${goalId}`);
    await this.schedulerCore.cancelGoal(goalId);
  }

  /**
   * Shared elaborate → plan → delegate sequence.
   * Used by both submitGoal (new goal) and processQueuedGoal (existing goal).
   */
  private async elaboratePlanDelegate(goal: Goal): Promise<GoalHarnessResult> {
    // Step 2: Elaborate — inject GlobalKnowledgeService pitfalls, validate
    this.logger.info({ goalId: goal.id, event: 'elaborating' }, `Elaborating goal: ${goal.id}`);
    const elaboration = await this.elaborationService.elaborateGoal(goal);

    if (elaboration.clarifications.length > 0) {
      this.logger.info(
        { goalId: goal.id, event: 'elaboration_clarifications', count: elaboration.clarifications.length },
        `Elaboration clarifications for goal ${goal.id}: ${elaboration.clarifications.join('; ')}`,
      );
    }

    // Step 3: If escalations → block goal, do not delegate
    if (elaboration.escalations.length > 0) {
      this.logger.warn(
        { goalId: goal.id, event: 'elaboration_escalated', count: elaboration.escalations.length },
        `Elaboration escalated goal ${goal.id} (${elaboration.escalations.length} issue(s)) — goal blocked`,
      );
      this.repository.updateGoalStatus(goal.id, 'blocked');

      return {
        goal,
        elaborationApplied: true,
        planGenerated: false,
        workItemCount: 0,
        escalations: elaboration.escalations,
        delegatedToScheduler: false,
      };
    }

    // Step 4: Plan — generate WorkItem DAG from elaborated goal
    this.logger.info({ goalId: goal.id, event: 'planning' }, `Planning goal: ${goal.id}`);
    const plan = await this.planningService.planWorkItems(goal);

    if (plan.workItems.length === 0) {
      this.logger.warn({ goalId: goal.id, event: 'empty_plan' }, `Planning returned 0 work items for goal ${goal.id}`);
      return {
        goal,
        elaborationApplied: true,
        planGenerated: true,
        workItemCount: 0,
        escalations: [],
        delegatedToScheduler: false,
      };
    }

    this.logger.info(
      { goalId: goal.id, event: 'plan_created', workItemCount: plan.workItems.length },
      `Plan created with ${plan.workItems.length} work items for goal ${goal.id}`,
    );

    // Step 4.5: If review_plan mode, pause at plan_review instead of delegating
    const reviewPlan = goal.context?.review_plan === true;
    if (reviewPlan) {
      this.repository.updateGoalStatus(goal.id, 'plan_review');
      this.logger.info({ goalId: goal.id, event: 'plan_review_paused' }, `Goal ${goal.id} paused at plan_review — awaiting approval`);

      return {
        goal: { ...goal, status: 'plan_review' as const },
        elaborationApplied: true,
        planGenerated: true,
        workItemCount: plan.workItems.length,
        escalations: [],
        delegatedToScheduler: false,
        awaitingPlanReview: true,
      };
    }

    // Step 5: Mark goal active
    this.repository.updateGoalStatus(goal.id, 'active');

    // Step 6: Delegate to SchedulerCore
    this.logger.info({ goalId: goal.id, event: 'delegating_to_scheduler' }, `Delegating goal ${goal.id} to SchedulerCore`);
    await this.schedulerCore.submitGoal(goal);

    return {
      goal,
      elaborationApplied: true,
      planGenerated: true,
      workItemCount: plan.workItems.length,
      escalations: [],
      delegatedToScheduler: true,
    };
  }
}
