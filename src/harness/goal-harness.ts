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

export interface GoalHarnessDependencies {
  repository: IWorkOrderRepository;
  elaborationService: IElaborationService;
  planningService: IPlanningService;
  schedulerCore: ISchedulerCore;
}

export class GoalHarness implements IGoalHarness {
  private readonly repository: IWorkOrderRepository;
  private readonly elaborationService: IElaborationService;
  private readonly planningService: IPlanningService;
  private readonly schedulerCore: ISchedulerCore;

  constructor(deps: GoalHarnessDependencies) {
    this.repository = deps.repository;
    this.elaborationService = deps.elaborationService;
    this.planningService = deps.planningService;
    this.schedulerCore = deps.schedulerCore;
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

    console.log(`[GoalHarness] Created goal: ${goal.title} (${goal.id})`);

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

    console.log(`[GoalHarness] Processing queued goal: ${goal.title} (${goal.id})`);

    return this.elaboratePlanDelegate(goal);
  }

  async cancelGoal(goalId: string): Promise<void> {
    console.log(`[GoalHarness] Cancelling goal: ${goalId}`);
    await this.schedulerCore.cancelGoal(goalId);
  }

  /**
   * Shared elaborate → plan → delegate sequence.
   * Used by both submitGoal (new goal) and processQueuedGoal (existing goal).
   */
  private async elaboratePlanDelegate(goal: Goal): Promise<GoalHarnessResult> {
    // Step 2: Elaborate — inject GlobalKnowledgeService pitfalls, validate
    console.log(`[GoalHarness] Elaborating goal: ${goal.id}`);
    const elaboration = await this.elaborationService.elaborateGoal(goal);

    if (elaboration.clarifications.length > 0) {
      console.log(`[GoalHarness] Elaboration clarifications for goal ${goal.id}:`);
      for (const clarification of elaboration.clarifications) {
        console.log(`  - ${clarification}`);
      }
    }

    // Step 3: If escalations → block goal, do not delegate
    if (elaboration.escalations.length > 0) {
      console.warn(
        `[GoalHarness] Elaboration escalated goal ${goal.id} ` +
          `(${elaboration.escalations.length} issue(s)) — goal blocked, not delegated to scheduler`
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
    console.log(`[GoalHarness] Planning goal: ${goal.id}`);
    const plan = await this.planningService.planWorkItems(goal);

    if (plan.workItems.length === 0) {
      console.warn(`[GoalHarness] Planning returned 0 work items for goal ${goal.id}`);
      return {
        goal,
        elaborationApplied: true,
        planGenerated: true,
        workItemCount: 0,
        escalations: [],
        delegatedToScheduler: false,
      };
    }

    console.log(
      `[GoalHarness] Plan created with ${plan.workItems.length} work items for goal ${goal.id}`
    );

    // Step 5: Mark goal active
    this.repository.updateGoalStatus(goal.id, 'active');

    // Step 6: Delegate to SchedulerCore
    console.log(`[GoalHarness] Delegating goal ${goal.id} to SchedulerCore`);
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
