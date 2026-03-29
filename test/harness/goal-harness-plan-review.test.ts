/**
 * GoalHarness Plan Review Tests
 *
 * Tests the plan_review workflow: when a goal is submitted with
 * context.review_plan = true, GoalHarness pauses after planning
 * and waits for explicit approval before delegating to SchedulerCore.
 */

import { GoalHarness } from '../../src/harness/goal-harness.js';
import type { GoalSubmission } from '../../src/harness/goal-harness-interface.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { IElaborationService, IPlanningService } from '../../src/app/lifecycle/stage-interfaces.js';
import type { ISchedulerCore } from '../../src/scheduler/core/types.js';
import type { Goal, WorkItem } from '../../src/work-order/types/index.js';

// --- Helpers ---

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 'Test Goal',
    description: 'A test goal',
    success_criteria: [
      { description: 'Tests pass', type: 'deterministic', verification_method: 'npm test', required: true },
    ],
    status: 'queued',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    ...overrides,
  };
}

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'A test work item',
    item_type: 'code',
    status: 'queued',
    priority: 1,
    effort_estimate: 'S',
    retry_count: 0,
    max_retries: 3,
    dependencies: [],
    verification_plan: [],
    ...overrides,
  } as WorkItem;
}

function makeSubmission(overrides: Partial<GoalSubmission> = {}): GoalSubmission {
  return {
    title: 'Test Goal',
    description: 'A test goal',
    success_criteria: [
      { description: 'Tests pass', type: 'deterministic', verification_method: 'npm test', required: true },
    ],
    ...overrides,
  };
}

function createMockRepository(): jest.Mocked<Pick<IWorkOrderRepository, 'createGoal' | 'getGoal' | 'updateGoalStatus' | 'listGoals' | 'initialize' | 'close'>> {
  return {
    createGoal: jest.fn(),
    getGoal: jest.fn(),
    updateGoalStatus: jest.fn(),
    listGoals: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  };
}

function createMockElaborationService(): jest.Mocked<IElaborationService> {
  return {
    elaborateGoal: jest.fn(),
  };
}

function createMockPlanningService(): jest.Mocked<IPlanningService> {
  return {
    planWorkItems: jest.fn(),
  };
}

function createMockSchedulerCore(): jest.Mocked<Pick<ISchedulerCore, 'submitGoal' | 'cancelGoal'>> {
  return {
    submitGoal: jest.fn().mockResolvedValue(undefined),
    cancelGoal: jest.fn().mockResolvedValue(undefined),
  };
}

// --- Tests ---

describe('GoalHarness plan_review', () => {
  let repository: ReturnType<typeof createMockRepository>;
  let elaborationService: ReturnType<typeof createMockElaborationService>;
  let planningService: ReturnType<typeof createMockPlanningService>;
  let schedulerCore: ReturnType<typeof createMockSchedulerCore>;
  let harness: GoalHarness;

  beforeEach(() => {
    repository = createMockRepository();
    elaborationService = createMockElaborationService();
    planningService = createMockPlanningService();
    schedulerCore = createMockSchedulerCore();

    harness = new GoalHarness({
      repository: repository as unknown as IWorkOrderRepository,
      elaborationService,
      planningService,
      schedulerCore: schedulerCore as unknown as ISchedulerCore,
    });
  });

  describe('submitGoal with review_plan context', () => {
    it('pauses at plan_review when goal context has review_plan: true', async () => {
      const goal = makeGoal({ context: { review_plan: true } });
      const workItems = [makeWorkItem(), makeWorkItem({ id: 'wi-2', title: 'Second item' })];

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems,
        dependencies: new Map(),
      });

      const result = await harness.submitGoal(makeSubmission({
        context: { review_plan: true },
      }));

      // Should NOT delegate to scheduler
      expect(result.delegatedToScheduler).toBe(false);
      expect(result.awaitingPlanReview).toBe(true);
      expect(result.planGenerated).toBe(true);
      expect(result.workItemCount).toBe(2);

      // Should set status to plan_review
      expect(repository.updateGoalStatus).toHaveBeenCalledWith(goal.id, 'plan_review');

      // Should NOT have called schedulerCore.submitGoal
      expect(schedulerCore.submitGoal).not.toHaveBeenCalled();
    });

    it('does NOT pause when review_plan is not set', async () => {
      const goal = makeGoal();
      const workItems = [makeWorkItem()];

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems,
        dependencies: new Map(),
      });

      const result = await harness.submitGoal(makeSubmission());

      // Normal flow: delegated to scheduler
      expect(result.delegatedToScheduler).toBe(true);
      expect(result.awaitingPlanReview).toBeFalsy();

      // Should set status to active, not plan_review
      expect(repository.updateGoalStatus).toHaveBeenCalledWith(goal.id, 'active');

      // Scheduler should have been called
      expect(schedulerCore.submitGoal).toHaveBeenCalledWith(goal);
    });
  });

  describe('approvePlan', () => {
    it('transitions plan_review goal to active and delegates to scheduler', async () => {
      const goal = makeGoal({ id: 'goal-pr', status: 'plan_review' });
      repository.getGoal.mockReturnValue(goal);

      await harness.approvePlan('goal-pr');

      // Should mark goal as active
      expect(repository.updateGoalStatus).toHaveBeenCalledWith('goal-pr', 'active');

      // Should delegate to SchedulerCore
      expect(schedulerCore.submitGoal).toHaveBeenCalledWith(goal);
    });

    it('rejects if goal is not in plan_review status', async () => {
      const goal = makeGoal({ id: 'goal-active', status: 'active' });
      repository.getGoal.mockReturnValue(goal);

      await expect(harness.approvePlan('goal-active')).rejects.toThrow(
        '[GoalHarness] Goal goal-active is not in plan_review (status: active)'
      );

      // Should NOT have changed status or delegated
      expect(repository.updateGoalStatus).not.toHaveBeenCalled();
      expect(schedulerCore.submitGoal).not.toHaveBeenCalled();
    });

    it('rejects if goal not found', async () => {
      repository.getGoal.mockReturnValue(undefined);

      await expect(harness.approvePlan('nonexistent')).rejects.toThrow(
        '[GoalHarness] Goal not found: nonexistent'
      );

      expect(repository.updateGoalStatus).not.toHaveBeenCalled();
      expect(schedulerCore.submitGoal).not.toHaveBeenCalled();
    });
  });
});
