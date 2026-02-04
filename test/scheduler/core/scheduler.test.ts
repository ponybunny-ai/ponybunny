import { SchedulerCore } from '../../../src/scheduler/core/scheduler.js';
import type {
  SchedulerDependencies,
  ISchedulerRepository,
  IModelSelectorAdapter,
  ILaneSelectorAdapter,
  IBudgetTrackerAdapter,
  IRetryHandlerAdapter,
  IEscalationHandlerAdapter,
  IQualityGateRunnerAdapter,
  IWorkItemManagerAdapter,
  IExecutionEngineAdapter,
} from '../../../src/scheduler/core/types.js';
import type { Goal, WorkItem, Run } from '../../../src/work-order/types/index.js';
import type { SchedulerEvent } from '../../../src/scheduler/types.js';

describe('SchedulerCore', () => {
  let scheduler: SchedulerCore;
  let mockDeps: SchedulerDependencies;
  let mockRepository: jest.Mocked<ISchedulerRepository>;
  let mockModelSelector: jest.Mocked<IModelSelectorAdapter>;
  let mockLaneSelector: jest.Mocked<ILaneSelectorAdapter>;
  let mockBudgetTracker: jest.Mocked<IBudgetTrackerAdapter>;
  let mockRetryHandler: jest.Mocked<IRetryHandlerAdapter>;
  let mockEscalationHandler: jest.Mocked<IEscalationHandlerAdapter>;
  let mockQualityGateRunner: jest.Mocked<IQualityGateRunnerAdapter>;
  let mockWorkItemManager: jest.Mocked<IWorkItemManagerAdapter>;
  let mockExecutionEngine: jest.Mocked<IExecutionEngineAdapter>;

  const createGoal = (overrides: Partial<Goal> = {}): Goal => ({
    id: 'goal-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 'Test Goal',
    description: 'Test description',
    success_criteria: [],
    status: 'active',
    priority: 50,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    ...overrides,
  });

  const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'Test description',
    item_type: 'code',
    status: 'ready',
    priority: 50,
    dependencies: [],
    blocks: [],
    estimated_effort: 'M',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    ...overrides,
  });

  const createRun = (overrides: Partial<Run> = {}): Run => ({
    id: 'run-1',
    created_at: Date.now(),
    work_item_id: 'wi-1',
    goal_id: 'goal-1',
    agent_type: 'code',
    run_sequence: 1,
    status: 'running',
    tokens_used: 0,
    cost_usd: 0,
    artifacts: [],
    ...overrides,
  });

  beforeEach(() => {
    // Create mock repository
    mockRepository = {
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
      getWorkItemsForGoal: jest.fn().mockReturnValue([]),
      getWorkItem: jest.fn(),
      updateWorkItemStatus: jest.fn(),
      createRun: jest.fn().mockReturnValue(createRun()),
      completeRun: jest.fn(),
      getRunsByWorkItem: jest.fn().mockReturnValue([]),
    };

    // Create mock model selector
    mockModelSelector = {
      selectModel: jest.fn().mockReturnValue({
        model: 'claude-3-5-sonnet',
        tier: 'standard',
        reason: 'Default selection',
      }),
    };

    // Create mock lane selector
    mockLaneSelector = {
      selectLane: jest.fn().mockReturnValue({
        laneId: 'main',
        reason: 'Default lane',
      }),
      hasCapacity: jest.fn().mockReturnValue(true),
      incrementActive: jest.fn(),
      decrementActive: jest.fn(),
    };

    // Create mock budget tracker
    mockBudgetTracker = {
      getBudgetStatus: jest.fn().mockReturnValue({
        goalId: 'goal-1',
        warningLevel: 'none',
        budget: {
          tokens: { spent: 0 },
          time: { spentMinutes: 0 },
          cost: { spentUsd: 0 },
        },
        checkResult: { withinBudget: true, violations: [] },
      }),
      willExceedBudget: jest.fn().mockReturnValue(false),
      recordUsage: jest.fn().mockResolvedValue(undefined),
    };

    // Create mock retry handler
    mockRetryHandler = {
      decideRetry: jest.fn().mockReturnValue({
        shouldRetry: false,
        strategy: 'escalate',
        reason: 'Max retries exceeded',
      }),
    };

    // Create mock escalation handler
    mockEscalationHandler = {
      hasBlockingEscalations: jest.fn().mockResolvedValue(false),
      createEscalation: jest.fn().mockResolvedValue({ id: 'esc-1' }),
    };

    // Create mock quality gate runner
    mockQualityGateRunner = {
      runVerification: jest.fn().mockResolvedValue({
        workItemId: 'wi-1',
        runId: 'run-1',
        allPassed: true,
        requiredPassed: true,
        results: [],
        summary: 'All gates passed',
        totalDurationMs: 100,
      }),
    };

    // Create mock work item manager
    mockWorkItemManager = {
      getNextWorkItem: jest.fn().mockResolvedValue(null),
      getReadyWorkItems: jest.fn().mockResolvedValue([]),
      areAllWorkItemsComplete: jest.fn().mockResolvedValue(false),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      areDependenciesSatisfied: jest.fn().mockResolvedValue(true),
    };

    // Create mock execution engine
    mockExecutionEngine = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        tokensUsed: 1000,
        timeSeconds: 60,
        costUsd: 0.01,
        artifacts: [],
      }),
      abort: jest.fn().mockResolvedValue(undefined),
    };

    mockDeps = {
      repository: mockRepository,
      modelSelector: mockModelSelector,
      laneSelector: mockLaneSelector,
      budgetTracker: mockBudgetTracker,
      retryHandler: mockRetryHandler,
      escalationHandler: mockEscalationHandler,
      qualityGateRunner: mockQualityGateRunner,
      workItemManager: mockWorkItemManager,
      executionEngine: mockExecutionEngine,
    };

    scheduler = new SchedulerCore(mockDeps);
  });

  afterEach(async () => {
    await scheduler.stop();
  });

  describe('lifecycle', () => {
    it('should start in idle state', () => {
      const state = scheduler.getState();
      expect(state.status).toBe('idle');
      expect(state.activeGoals).toHaveLength(0);
    });

    it('should transition to running on start', async () => {
      await scheduler.start();
      expect(scheduler.getState().status).toBe('running');
    });

    it('should not start twice', async () => {
      await scheduler.start();
      await scheduler.start();
      expect(scheduler.getState().status).toBe('running');
    });

    it('should pause and resume', async () => {
      await scheduler.start();
      expect(scheduler.getState().status).toBe('running');

      await scheduler.pause();
      expect(scheduler.getState().status).toBe('paused');

      await scheduler.resume();
      expect(scheduler.getState().status).toBe('running');
    });

    it('should stop scheduler', async () => {
      await scheduler.start();
      await scheduler.stop();
      expect(scheduler.getState().status).toBe('stopped');
    });

    it('should not resume if not paused', async () => {
      await scheduler.resume();
      expect(scheduler.getState().status).toBe('idle');
    });
  });

  describe('goal submission', () => {
    it('should submit a goal', async () => {
      const goal = createGoal();
      await scheduler.submitGoal(goal);

      const state = scheduler.getState();
      expect(state.activeGoals).toContain('goal-1');

      const goalState = scheduler.getGoalState('goal-1');
      expect(goalState).toBeDefined();
      expect(goalState?.status).toBe('pending');
    });

    it('should auto-start when configured', async () => {
      scheduler = new SchedulerCore(mockDeps, { autoStart: true });

      const goal = createGoal();
      await scheduler.submitGoal(goal);

      expect(scheduler.getState().status).toBe('running');

      await scheduler.stop();
    });

    it('should emit goal_started event', async () => {
      const events: SchedulerEvent[] = [];
      scheduler.on((event) => { events.push(event); });

      const goal = createGoal();
      await scheduler.submitGoal(goal);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('goal_started');
      expect(events[0].goalId).toBe('goal-1');
    });

    it('should get all goal states', async () => {
      await scheduler.submitGoal(createGoal({ id: 'goal-1' }));
      await scheduler.submitGoal(createGoal({ id: 'goal-2' }));

      const states = scheduler.getAllGoalStates();
      expect(states).toHaveLength(2);
    });
  });

  describe('goal cancellation', () => {
    it('should cancel a goal', async () => {
      const goal = createGoal();
      await scheduler.submitGoal(goal);
      await scheduler.cancelGoal('goal-1');

      const goalState = scheduler.getGoalState('goal-1');
      expect(goalState?.status).toBe('cancelled');
      expect(scheduler.getState().activeGoals).not.toContain('goal-1');
    });

    it('should update repository on cancel', async () => {
      const goal = createGoal();
      await scheduler.submitGoal(goal);
      await scheduler.cancelGoal('goal-1');

      expect(mockRepository.updateGoalStatus).toHaveBeenCalledWith('goal-1', 'cancelled');
    });

    it('should handle cancelling non-existent goal', async () => {
      await scheduler.cancelGoal('non-existent');
      // Should not throw
    });
  });

  describe('tick processing', () => {
    it('should not process when not running', async () => {
      await scheduler.tick();
      expect(mockRepository.getGoal).not.toHaveBeenCalled();
    });

    it('should process active goals on tick', async () => {
      const goal = createGoal();
      mockRepository.getGoal.mockReturnValue(goal);

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockRepository.getGoal).toHaveBeenCalledWith('goal-1');
    });

    it('should skip goal with blocking escalations', async () => {
      const goal = createGoal();
      mockRepository.getGoal.mockReturnValue(goal);
      mockEscalationHandler.hasBlockingEscalations.mockResolvedValue(true);

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockWorkItemManager.getNextWorkItem).not.toHaveBeenCalled();
    });

    it('should handle budget exceeded', async () => {
      const goal = createGoal();
      mockRepository.getGoal.mockReturnValue(goal);
      mockBudgetTracker.getBudgetStatus.mockReturnValue({
        goalId: 'goal-1',
        warningLevel: 'exceeded',
        budget: {
          tokens: { spent: 10000, limit: 5000 },
          time: { spentMinutes: 0 },
          cost: { spentUsd: 0 },
        },
        checkResult: { withinBudget: false, violations: [] },
      });

      const events: SchedulerEvent[] = [];
      scheduler.on((event) => { events.push(event); });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockEscalationHandler.createEscalation).toHaveBeenCalled();
      expect(events.some((e) => e.type === 'budget_exceeded')).toBe(true);
    });

    it('should emit budget warning', async () => {
      const goal = createGoal();
      mockRepository.getGoal.mockReturnValue(goal);
      mockBudgetTracker.getBudgetStatus.mockReturnValue({
        goalId: 'goal-1',
        warningLevel: 'warning',
        budget: {
          tokens: { spent: 4000, limit: 5000 },
          time: { spentMinutes: 0 },
          cost: { spentUsd: 0 },
        },
        checkResult: { withinBudget: true, violations: [] },
      });

      const events: SchedulerEvent[] = [];
      scheduler.on((event) => { events.push(event); });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(events.some((e) => e.type === 'budget_warning')).toBe(true);
    });

    it('should complete goal when all work items done', async () => {
      const goal = createGoal();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.areAllWorkItemsComplete.mockResolvedValue(true);

      const events: SchedulerEvent[] = [];
      scheduler.on((event) => { events.push(event); });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockRepository.updateGoalStatus).toHaveBeenCalledWith('goal-1', 'completed');
      expect(events.some((e) => e.type === 'goal_completed')).toBe(true);

      const goalState = scheduler.getGoalState('goal-1');
      expect(goalState?.status).toBe('completed');
    });
  });

  describe('work item execution', () => {
    it('should start work item execution', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValue(workItem);

      const events: SchedulerEvent[] = [];
      scheduler.on((event) => { events.push(event); });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockModelSelector.selectModel).toHaveBeenCalledWith(workItem, goal);
      expect(mockLaneSelector.selectLane).toHaveBeenCalledWith(workItem, goal);
      expect(mockRepository.createRun).toHaveBeenCalled();
      expect(events.some((e) => e.type === 'work_item_started')).toBe(true);
    });

    it('should skip if lane at capacity', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValue(workItem);
      mockLaneSelector.hasCapacity.mockReturnValue(false);

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockRepository.createRun).not.toHaveBeenCalled();
    });

    it('should handle successful execution', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);

      const events: SchedulerEvent[] = [];
      scheduler.on((event) => { events.push(event); });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockBudgetTracker.recordUsage).toHaveBeenCalled();
      expect(mockRepository.completeRun).toHaveBeenCalled();
      expect(mockQualityGateRunner.runVerification).toHaveBeenCalled();
    });

    it('should handle execution failure with retry', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      mockExecutionEngine.execute.mockResolvedValue({
        success: false,
        tokensUsed: 500,
        timeSeconds: 30,
        costUsd: 0.005,
        artifacts: [],
        error: { code: 'TEST_ERROR', message: 'Test failed', recoverable: true },
      });
      mockRetryHandler.decideRetry.mockReturnValue({
        shouldRetry: true,
        strategy: 'same_model',
        reason: 'Recoverable error',
      });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockWorkItemManager.updateStatus).toHaveBeenCalledWith('wi-1', 'queued');
    });

    it('should handle execution failure with escalation', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      mockExecutionEngine.execute.mockResolvedValue({
        success: false,
        tokensUsed: 500,
        timeSeconds: 30,
        costUsd: 0.005,
        artifacts: [],
        error: { code: 'TEST_ERROR', message: 'Test failed', recoverable: true },
      });
      mockRetryHandler.decideRetry.mockReturnValue({
        shouldRetry: true,
        strategy: 'escalate',
        reason: 'Needs human intervention',
      });

      const events: SchedulerEvent[] = [];
      scheduler.on((event) => { events.push(event); });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockEscalationHandler.createEscalation).toHaveBeenCalled();
      expect(events.some((e) => e.type === 'escalation_created')).toBe(true);
    });

    it('should handle verification failure', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      mockQualityGateRunner.runVerification.mockResolvedValue({
        workItemId: 'wi-1',
        runId: 'run-1',
        allPassed: false,
        requiredPassed: false,
        results: [{ gateName: 'test', gateType: 'deterministic', passed: false, required: true, durationMs: 100 }],
        summary: 'Required gates failed',
        totalDurationMs: 100,
      });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockRetryHandler.decideRetry).toHaveBeenCalled();
    });
  });

  describe('event handling', () => {
    it('should subscribe and unsubscribe handlers', async () => {
      const events: SchedulerEvent[] = [];
      const handler = (event: SchedulerEvent) => { events.push(event); };

      scheduler.on(handler);
      await scheduler.submitGoal(createGoal());
      expect(events).toHaveLength(1);

      scheduler.off(handler);
      await scheduler.submitGoal(createGoal({ id: 'goal-2' }));
      expect(events).toHaveLength(1); // No new events
    });

    it('should handle async event handlers', async () => {
      const events: SchedulerEvent[] = [];
      const asyncHandler = async (event: SchedulerEvent) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push(event);
      };

      scheduler.on(asyncHandler);
      await scheduler.submitGoal(createGoal());

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events).toHaveLength(1);
    });

    it('should handle handler errors gracefully', async () => {
      const errorHandler = () => {
        throw new Error('Handler error');
      };

      scheduler.on(errorHandler);
      // Should not throw
      await scheduler.submitGoal(createGoal());
    });
  });

  describe('metrics', () => {
    it('should return initial metrics', () => {
      const metrics = scheduler.getMetrics();

      expect(metrics.totalGoalsProcessed).toBe(0);
      expect(metrics.totalWorkItemsCompleted).toBe(0);
      expect(metrics.totalRunsExecuted).toBe(0);
      expect(metrics.currentActiveGoals).toBe(0);
      expect(metrics.currentActiveWorkItems).toBe(0);
    });

    it('should track active goals', async () => {
      await scheduler.submitGoal(createGoal({ id: 'goal-1' }));
      await scheduler.submitGoal(createGoal({ id: 'goal-2' }));

      const metrics = scheduler.getMetrics();
      expect(metrics.currentActiveGoals).toBe(2);
    });

    it('should update metrics after goal completion', async () => {
      const goal = createGoal();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.areAllWorkItemsComplete.mockResolvedValue(true);

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      const metrics = scheduler.getMetrics();
      expect(metrics.totalGoalsProcessed).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should use default config', () => {
      const state = scheduler.getState();
      expect(state.status).toBe('idle');
    });

    it('should accept custom config', () => {
      scheduler = new SchedulerCore(mockDeps, {
        tickIntervalMs: 500,
        maxConcurrentGoals: 10,
        debug: true,
      });

      // Config is internal, but we can verify it works
      expect(scheduler.getState().status).toBe('idle');
    });
  });

  describe('lane status', () => {
    it('should initialize all lanes', () => {
      const state = scheduler.getState();

      expect(state.lanes.main).toBeDefined();
      expect(state.lanes.subagent).toBeDefined();
      expect(state.lanes.cron).toBeDefined();
      expect(state.lanes.session).toBeDefined();
    });

    it('should track lane availability', () => {
      const state = scheduler.getState();

      expect(state.lanes.main.isAvailable).toBe(true);
      expect(state.lanes.main.activeCount).toBe(0);
    });
  });
});
