/**
 * GoalHarness Unit Tests — ADR-001 Phase 1
 *
 * Tests GoalHarness in isolation with fully mocked dependencies.
 * Verifies the elaborate → plan → delegate sequence and all invariants.
 */

import { GoalHarness } from '../../src/harness/goal-harness.js';
import type { GoalSubmission } from '../../src/harness/goal-harness-interface.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { IElaborationService, IPlanningService } from '../../src/app/lifecycle/stage-interfaces.js';
import type { ISchedulerCore } from '../../src/scheduler/core/types.js';
import type { Goal, WorkItem } from '../../src/work-order/types/index.js';
import { IntentClassificationService } from '../../src/app/lifecycle/intake/intent-classification-service.js';
import type { GoalIntent } from '../../src/domain/work-order/types/goal-intent.js';
import type { ILLMService } from '../../src/infra/llm/llm-service.interface.js';
import { NoopLogger } from '../../src/infra/observability/logger.js';

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

function createMockRepository(): jest.Mocked<Pick<IWorkOrderRepository, 'createGoal' | 'getGoal' | 'updateGoalStatus' | 'updateGoalContext' | 'listGoals' | 'initialize' | 'close'>> {
  return {
    createGoal: jest.fn(),
    getGoal: jest.fn(),
    updateGoalStatus: jest.fn(),
    updateGoalContext: jest.fn(),
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

describe('GoalHarness', () => {
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

  describe('submitGoal', () => {
    it('creates goal, elaborates, plans, and delegates to scheduler', async () => {
      const goal = makeGoal();
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

      const result = await harness.submitGoal(makeSubmission());

      // Verify creation
      expect(repository.createGoal).toHaveBeenCalledWith({
        title: 'Test Goal',
        description: 'A test goal',
        success_criteria: expect.any(Array),
        priority: undefined,
        budget_tokens: undefined,
        budget_time_minutes: undefined,
        budget_cost_usd: undefined,
        context: undefined,
      });

      // Verify elaboration
      expect(elaborationService.elaborateGoal).toHaveBeenCalledWith(goal);

      // Verify planning
      expect(planningService.planWorkItems).toHaveBeenCalledWith(goal);

      // Verify goal marked active
      expect(repository.updateGoalStatus).toHaveBeenCalledWith(goal.id, 'active');

      // Verify delegation to SchedulerCore
      expect(schedulerCore.submitGoal).toHaveBeenCalledWith(goal);

      // Verify result
      expect(result).toEqual({
        goal,
        elaborationApplied: true,
        planGenerated: true,
        workItemCount: 2,
        escalations: [],
        delegatedToScheduler: true,
      });
    });

    it('blocks goal when elaboration produces escalations', async () => {
      const goal = makeGoal();

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: ['Missing success criteria', 'Budget too low'],
      });

      const result = await harness.submitGoal(makeSubmission());

      // Verify goal is blocked
      expect(repository.updateGoalStatus).toHaveBeenCalledWith(goal.id, 'blocked');

      // Verify planning was NOT called
      expect(planningService.planWorkItems).not.toHaveBeenCalled();

      // Verify scheduler was NOT called
      expect(schedulerCore.submitGoal).not.toHaveBeenCalled();

      expect(result).toEqual({
        goal,
        elaborationApplied: true,
        planGenerated: false,
        workItemCount: 0,
        escalations: ['Missing success criteria', 'Budget too low'],
        delegatedToScheduler: false,
      });
    });

    it('does not delegate when planning returns 0 work items', async () => {
      const goal = makeGoal();

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [],
        dependencies: new Map(),
      });

      const result = await harness.submitGoal(makeSubmission());

      // Verify goal was NOT marked active
      expect(repository.updateGoalStatus).not.toHaveBeenCalled();

      // Verify scheduler was NOT called
      expect(schedulerCore.submitGoal).not.toHaveBeenCalled();

      expect(result).toEqual({
        goal,
        elaborationApplied: true,
        planGenerated: true,
        workItemCount: 0,
        escalations: [],
        delegatedToScheduler: false,
      });
    });

    it('passes optional budget and context fields through to createGoal', async () => {
      const goal = makeGoal({ budget_tokens: 5000, budget_cost_usd: 1.5 });

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      await harness.submitGoal(makeSubmission({
        budget_tokens: 5000,
        budget_cost_usd: 1.5,
        context: { source: 'gateway' },
      }));

      expect(repository.createGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          budget_tokens: 5000,
          budget_cost_usd: 1.5,
          context: { source: 'gateway' },
        })
      );
    });

    it('logs clarifications without blocking', async () => {
      const goal = makeGoal();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: ['Consider adding timeout criteria'],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      const result = await harness.submitGoal(makeSubmission());

      // Goal should proceed despite clarifications
      expect(result.delegatedToScheduler).toBe(true);
      expect(result.elaborationApplied).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('processQueuedGoal', () => {
    it('processes an existing queued goal through elaborate → plan → delegate', async () => {
      const goal = makeGoal({ id: 'existing-goal', status: 'queued' });
      const workItems = [makeWorkItem({ goal_id: 'existing-goal' })];

      repository.getGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems,
        dependencies: new Map(),
      });

      const result = await harness.processQueuedGoal('existing-goal');

      // Should NOT create a new goal
      expect(repository.createGoal).not.toHaveBeenCalled();

      // Should elaborate
      expect(elaborationService.elaborateGoal).toHaveBeenCalledWith(goal);

      // Should plan
      expect(planningService.planWorkItems).toHaveBeenCalledWith(goal);

      // Should delegate
      expect(schedulerCore.submitGoal).toHaveBeenCalledWith(goal);

      expect(result.delegatedToScheduler).toBe(true);
      expect(result.workItemCount).toBe(1);
    });

    it('throws when goal is not found', async () => {
      repository.getGoal.mockReturnValue(undefined);

      await expect(harness.processQueuedGoal('nonexistent')).rejects.toThrow(
        '[GoalHarness] Goal not found: nonexistent'
      );
    });

    it('throws when goal is not in queued status', async () => {
      const goal = makeGoal({ id: 'active-goal', status: 'active' });
      repository.getGoal.mockReturnValue(goal);

      await expect(harness.processQueuedGoal('active-goal')).rejects.toThrow(
        '[GoalHarness] Goal active-goal is not queued (status: active)'
      );
    });

    it('blocks existing goal when elaboration escalates', async () => {
      const goal = makeGoal({ id: 'escalated-goal', status: 'queued' });

      repository.getGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: ['Cannot proceed without credentials'],
      });

      const result = await harness.processQueuedGoal('escalated-goal');

      expect(repository.updateGoalStatus).toHaveBeenCalledWith('escalated-goal', 'blocked');
      expect(schedulerCore.submitGoal).not.toHaveBeenCalled();
      expect(result.delegatedToScheduler).toBe(false);
      expect(result.escalations).toEqual(['Cannot proceed without credentials']);
    });
  });

  describe('cancelGoal', () => {
    it('delegates cancellation to SchedulerCore', async () => {
      await harness.cancelGoal('goal-to-cancel');

      expect(schedulerCore.cancelGoal).toHaveBeenCalledWith('goal-to-cancel');
    });
  });

  describe('invariant: GoalHarness never performs execution', () => {
    it('does not call any execution methods', async () => {
      const goal = makeGoal();

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      await harness.submitGoal(makeSubmission());

      // GoalHarness only calls: createGoal, elaborateGoal, planWorkItems, updateGoalStatus, submitGoal
      // It never calls executeWorkItem or any execution-related methods
      expect(schedulerCore.submitGoal).toHaveBeenCalledTimes(1);
    });
  });

  describe('invariant: SchedulerCore interface is not modified', () => {
    it('only calls submitGoal and cancelGoal on ISchedulerCore', async () => {
      const goal = makeGoal();

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      await harness.submitGoal(makeSubmission());

      // Only submitGoal should be called on schedulerCore
      const calledMethods = Object.keys(schedulerCore).filter(
        (key) => (schedulerCore as any)[key].mock?.calls?.length > 0
      );
      expect(calledMethods).toEqual(['submitGoal']);
    });
  });

  describe('invariant: every goal passes through elaboration', () => {
    it('calls elaborateGoal for submitGoal path', async () => {
      const goal = makeGoal();
      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      await harness.submitGoal(makeSubmission());
      expect(elaborationService.elaborateGoal).toHaveBeenCalledTimes(1);
    });

    it('calls elaborateGoal for processQueuedGoal path', async () => {
      const goal = makeGoal({ status: 'queued' });
      repository.getGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      await harness.processQueuedGoal(goal.id);
      expect(elaborationService.elaborateGoal).toHaveBeenCalledTimes(1);
    });
  });

  describe('invariant: every work item executes through SchedulerCore', () => {
    it('delegates to SchedulerCore.submitGoal after planning', async () => {
      const goal = makeGoal();
      const workItems = [makeWorkItem(), makeWorkItem({ id: 'wi-2' }), makeWorkItem({ id: 'wi-3' })];

      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal, clarifications: [], escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems,
        dependencies: new Map(),
      });

      const result = await harness.submitGoal(makeSubmission());

      expect(result.workItemCount).toBe(3);
      expect(result.delegatedToScheduler).toBe(true);
      expect(schedulerCore.submitGoal).toHaveBeenCalledWith(goal);
    });
  });

  describe('intent classification integration', () => {
    function makeHighConfidenceIntent(): GoalIntent {
      return {
        task_type: 'code_implementation',
        domain_tags: ['api'],
        extracted_constraints: [],
        scope_boundary: 'API layer',
        classification_confidence: 0.9,
      };
    }

    function makeLowConfidenceIntent(): GoalIntent {
      return {
        task_type: 'unknown',
        domain_tags: [],
        extracted_constraints: [],
        scope_boundary: '',
        classification_confidence: 0.3,
        clarification_questions: ['What exactly should be implemented?'],
      };
    }

    function createMockLLMService(): jest.Mocked<ILLMService> {
      return {
        complete: jest.fn(),
        completeWithModel: jest.fn(),
        getProviderHealth: jest.fn().mockReturnValue([]),
      };
    }

    it('proceeds to elaboration when classification confidence is high', async () => {
      const mockLLM = createMockLLMService();
      mockLLM.complete.mockResolvedValue({
        content: JSON.stringify(makeHighConfidenceIntent()),
        tokensUsed: 100,
        model: 'test',
        finishReason: 'stop',
      });

      const intentService = new IntentClassificationService(mockLLM, new NoopLogger());

      const harnessWithIntent = new GoalHarness({
        repository: repository as unknown as IWorkOrderRepository,
        elaborationService,
        planningService,
        schedulerCore: schedulerCore as unknown as ISchedulerCore,
        intentClassificationService: intentService,
      });

      const goal = makeGoal();
      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      const result = await harnessWithIntent.submitGoal(makeSubmission());

      // Should persist intent to context
      expect(repository.updateGoalContext).toHaveBeenCalledWith(
        goal.id,
        expect.objectContaining({ intent: makeHighConfidenceIntent() }),
      );

      // Should proceed to elaboration and delegation
      expect(elaborationService.elaborateGoal).toHaveBeenCalled();
      expect(result.delegatedToScheduler).toBe(true);
      expect(result.elaborationApplied).toBe(true);
    });

    it('blocks goal and returns early when classification confidence is low', async () => {
      const mockLLM = createMockLLMService();
      mockLLM.complete.mockResolvedValue({
        content: JSON.stringify(makeLowConfidenceIntent()),
        tokensUsed: 100,
        model: 'test',
        finishReason: 'stop',
      });

      const intentService = new IntentClassificationService(mockLLM, new NoopLogger());

      const harnessWithIntent = new GoalHarness({
        repository: repository as unknown as IWorkOrderRepository,
        elaborationService,
        planningService,
        schedulerCore: schedulerCore as unknown as ISchedulerCore,
        intentClassificationService: intentService,
      });

      const goal = makeGoal();
      repository.createGoal.mockReturnValue(goal);

      const result = await harnessWithIntent.submitGoal(makeSubmission());

      // Should block goal
      expect(repository.updateGoalStatus).toHaveBeenCalledWith(goal.id, 'blocked');

      // Should NOT proceed to elaboration
      expect(elaborationService.elaborateGoal).not.toHaveBeenCalled();

      // Should return escalation about low confidence
      expect(result.delegatedToScheduler).toBe(false);
      expect(result.elaborationApplied).toBe(false);
      expect(result.escalations.length).toBeGreaterThan(0);
      expect(result.escalations[0]).toContain('confidence too low');
    });

    it('blocks goal when intent classification throws an error', async () => {
      const mockLLM = createMockLLMService();
      mockLLM.complete.mockRejectedValue(new Error('LLM provider unavailable'));

      const intentService = new IntentClassificationService(mockLLM, new NoopLogger());

      const harnessWithIntent = new GoalHarness({
        repository: repository as unknown as IWorkOrderRepository,
        elaborationService,
        planningService,
        schedulerCore: schedulerCore as unknown as ISchedulerCore,
        intentClassificationService: intentService,
      });

      const goal = makeGoal();
      repository.createGoal.mockReturnValue(goal);

      const result = await harnessWithIntent.submitGoal(makeSubmission());

      expect(repository.updateGoalStatus).toHaveBeenCalledWith(goal.id, 'blocked');
      expect(elaborationService.elaborateGoal).not.toHaveBeenCalled();
      expect(result.delegatedToScheduler).toBe(false);
      expect(result.escalations[0]).toContain('Intent classification failed');
    });

    it('works without intentClassificationService (backward compatibility)', async () => {
      // The default harness (no intentClassificationService) should work as before
      const goal = makeGoal();
      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      const result = await harness.submitGoal(makeSubmission());

      // No intent classification call
      expect(repository.updateGoalContext).not.toHaveBeenCalled();

      // Should proceed normally
      expect(result.delegatedToScheduler).toBe(true);
      expect(result.elaborationApplied).toBe(true);
    });

    it('skips low-confidence blocking when skip_clarification is set', async () => {
      const mockLLM = createMockLLMService();
      mockLLM.complete.mockResolvedValue({
        content: JSON.stringify(makeLowConfidenceIntent()),
        tokensUsed: 100,
        model: 'test',
        finishReason: 'stop',
      });

      const intentService = new IntentClassificationService(mockLLM, new NoopLogger());

      const harnessWithIntent = new GoalHarness({
        repository: repository as unknown as IWorkOrderRepository,
        elaborationService,
        planningService,
        schedulerCore: schedulerCore as unknown as ISchedulerCore,
        intentClassificationService: intentService,
      });

      const goal = makeGoal({ context: { skip_clarification: true } });
      repository.createGoal.mockReturnValue(goal);
      elaborationService.elaborateGoal.mockResolvedValue({
        goal,
        clarifications: [],
        escalations: [],
      });
      planningService.planWorkItems.mockResolvedValue({
        workItems: [makeWorkItem()],
        dependencies: new Map(),
      });

      const result = await harnessWithIntent.submitGoal(makeSubmission({ context: { skip_clarification: true } }));

      // Should proceed despite low confidence
      expect(elaborationService.elaborateGoal).toHaveBeenCalled();
      expect(result.delegatedToScheduler).toBe(true);
    });
  });
});
