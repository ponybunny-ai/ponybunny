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
} from '../../../src/scheduler/core/types.js';
import type { ExecutionPort } from '../../../src/runtime/execution-boundary/index.js';
import type { EventBus as RuntimeEventBus, RuntimeEvent } from '../../../src/runtime/event-bus/index.js';
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
  let mockExecutionPort: jest.Mocked<ExecutionPort>;
  let mockRuntimeEventBus: jest.Mocked<RuntimeEventBus>;
  let runtimeEventHandler: ((event: RuntimeEvent) => void | Promise<void>) | undefined;

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
      getRun: jest.fn(),
      mergeRunContext: jest.fn(),
      claimEventedResultContinuation: jest.fn().mockImplementation((id: string, appliedAt?: number) => ({
        status: 'claimed',
        appliedAt,
        run: createRun({
          id,
          context: {
            evented_dispatch: {
              execution_mode: 'evented',
              lane_id: 'main',
              dispatched_at: 1000,
              result_continuation_applied: true,
              result_continuation_applied_at: appliedAt,
            },
          },
        }),
      })),
      startEventedManualReplay: jest.fn(),
      completeRun: jest.fn(),
      getRunsByWorkItem: jest.fn().mockReturnValue([]),
      listInFlightRunReconciliationCandidates: jest.fn().mockReturnValue([]),
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
    mockExecutionPort = {
      execute: jest.fn().mockResolvedValue({
        runId: 'run-1',
        workItemId: 'wi-1',
        success: true,
        tokensUsed: 1000,
        timeSeconds: 60,
        costUsd: 0.01,
        artifacts: [],
      }),
      abort: jest.fn().mockResolvedValue(undefined),
    };

    mockRuntimeEventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
      subscribeAll: jest.fn().mockImplementation((handler: (event: RuntimeEvent) => void | Promise<void>) => {
        runtimeEventHandler = handler;
        return () => {
          if (runtimeEventHandler === handler) {
            runtimeEventHandler = undefined;
          }
        };
      }),
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
      executionPort: mockExecutionPort,
      runtimeEventBus: mockRuntimeEventBus,
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

    it('should route direct mode execution results through the shared post-execution continuation', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);

      const continuationSpy = jest.spyOn(scheduler as any, 'continueAfterExecutionResult');

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(continuationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workItem,
          goal,
          run: expect.objectContaining({ id: 'run-1' }),
        }),
        expect.objectContaining({
          runId: 'run-1',
          workItemId: 'wi-1',
          success: true,
        })
      );
    });

    it('should dispatch execution through ExecutionPort keyed by scheduler run id', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockExecutionPort.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          goalId: 'goal-1',
          workItemId: 'wi-1',
          workItem,
          model: 'claude-3-5-sonnet',
          laneId: 'main',
        })
      );
      expect(mockRuntimeEventBus.publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'task.ready' } as Partial<RuntimeEvent>)
      );
    });

    it('should publish task.ready in evented mode', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockRuntimeEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.ready',
          source: 'scheduler',
          runId: 'run-1',
          goalId: 'goal-1',
          workItemId: 'wi-1',
          payload: expect.objectContaining({
            runId: 'run-1',
            goalId: 'goal-1',
            workItemId: 'wi-1',
            workItem,
            model: 'claude-3-5-sonnet',
            laneId: 'main',
          }),
        })
      );
      expect(mockRepository.mergeRunContext).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          evented_dispatch: expect.objectContaining({
            execution_mode: 'evented',
            lane_id: 'main',
            result_continuation_applied: false,
          }),
        })
      );
    });

    it('should not directly execute work items in evented mode', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockExecutionPort.execute).not.toHaveBeenCalled();
    });

    it('should preserve direct mode behavior without writing an evented checkpoint', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      mockExecutionPort.execute.mockResolvedValue({
        runId: 'run-1',
        workItemId: 'wi-1',
        success: true,
        tokensUsed: 10,
        timeSeconds: 1,
        costUsd: 0.001,
        artifacts: [],
      });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(mockRepository.mergeRunContext).not.toHaveBeenCalled();
      expect(mockRepository.claimEventedResultContinuation).not.toHaveBeenCalled();
    });

    it('should dispatch a replay replacement run through the existing task.ready path', async () => {
      const goal = createGoal();
      const workItem = createWorkItem({ status: 'in_progress' });
      const originalRun = createRun({
        id: 'run-original',
        context: {
          selected_model: 'claude-3-5-sonnet',
          evented_dispatch: {
            execution_mode: 'evented',
            lane_id: 'main',
            dispatched_at: 1000,
            result_continuation_applied: false,
            orphan_classification: 'stale_timeout',
            recovery_candidate: true,
            replay_candidate: true,
            manual_replay: {
              requested_at: 2000,
              requested_reason: 'manual_operator_request',
              replacement_run_id: 'run-replay',
              replacement_run_created_at: 2000,
              original_continuation_suppressed_at: 2000,
            },
          },
        },
      });
      const replacementRun = createRun({
        id: 'run-replay',
        run_sequence: 2,
        context: {
          selected_model: 'claude-3-5-sonnet',
          evented_dispatch: {
            replay_of_run_id: 'run-original',
            replay_started_at: 2000,
          },
        },
      });

      mockRepository.getGoal.mockReturnValue(goal);
      mockRepository.getWorkItem.mockReturnValue(workItem);
      mockRepository.startEventedManualReplay.mockReturnValue({
        status: 'replay_started',
        requestedAt: 2000,
        requestedReason: 'manual_operator_request',
        originalRun,
        replacementRun,
      });
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      const result = await scheduler.replayRun('run-original');

      expect(result).toEqual(
        expect.objectContaining({
          status: 'replay_started',
          replacementRun: expect.objectContaining({ id: 'run-replay' }),
        })
      );
      expect(mockRuntimeEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task.ready',
          runId: 'run-replay',
          workItemId: 'wi-1',
          payload: expect.objectContaining({
            runId: 'run-replay',
            laneId: 'main',
            model: 'claude-3-5-sonnet',
          }),
        })
      );
      expect(mockRepository.mergeRunContext).toHaveBeenCalledWith(
        'run-replay',
        expect.objectContaining({
          evented_dispatch: expect.objectContaining({
            execution_mode: 'evented',
            lane_id: 'main',
            replay_of_run_id: 'run-original',
            replay_started_at: 2000,
            result_continuation_applied: false,
          }),
        })
      );
    });

    it('should suppress late original results after replay transferred continuation authority', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      mockRepository.claimEventedResultContinuation
        .mockReturnValueOnce({
          status: 'suppressed_by_replay',
          run: createRun({
            id: 'run-1',
            context: {
              evented_dispatch: {
                execution_mode: 'evented',
                lane_id: 'main',
                dispatched_at: 1000,
                result_continuation_applied: false,
                manual_replay: {
                  requested_at: 2000,
                  requested_reason: 'manual_operator_request',
                  replacement_run_id: 'run-2',
                  replacement_run_created_at: 2000,
                  original_continuation_suppressed_at: 2000,
                },
              },
            },
          }),
        })
        .mockReturnValue({
          status: 'claimed',
          run: createRun({
            id: 'run-1',
            context: {
              evented_dispatch: {
                execution_mode: 'evented',
                lane_id: 'main',
                dispatched_at: 1000,
                result_continuation_applied: true,
                result_continuation_applied_at: 3000,
              },
            },
          }),
        });
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      const continuationSpy = jest.spyOn(scheduler as any, 'continueAfterExecutionResult');

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      await runtimeEventHandler!({
        id: 'evt-replayed-original',
        type: 'execution.completed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          result: {
            runId: 'run-1',
            workItemId: 'wi-1',
            success: true,
            tokensUsed: 1,
            timeSeconds: 1,
            costUsd: 0.001,
            artifacts: [],
          },
        },
      });

      expect(continuationSpy).not.toHaveBeenCalled();
      expect(mockRepository.completeRun).not.toHaveBeenCalled();
      expect(mockLaneSelector.decrementActive).toHaveBeenCalledWith('main');
    });

    it('should reject replay attempts in direct mode', async () => {
      const result = await scheduler.replayRun('run-original');

      expect(result.status).toBe('not_evented_execution');
      expect(mockRepository.startEventedManualReplay).not.toHaveBeenCalled();
      expect(mockRuntimeEventBus.publish).not.toHaveBeenCalled();
    });

    it('should consume execution.completed as the authoritative evented completion signal', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(runtimeEventHandler).toBeDefined();
      expect(scheduler.getMetrics().currentActiveWorkItems).toBe(1);
      expect(mockLaneSelector.incrementActive).toHaveBeenCalledWith('main');
      expect(mockExecutionPort.execute).not.toHaveBeenCalled();

      await runtimeEventHandler!({
        id: 'evt-1',
        type: 'execution.completed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          request: {
            runId: 'run-1',
            goalId: 'goal-1',
            workItemId: 'wi-1',
            workItem,
            model: 'claude-3-5-sonnet',
            laneId: 'main',
            budgetRemaining: mockBudgetTracker.getBudgetStatus(goal),
          },
          result: {
            runId: 'run-1',
            workItemId: 'wi-1',
            success: true,
            tokensUsed: 1000,
            timeSeconds: 60,
            costUsd: 0.01,
            artifacts: [],
            actualModel: 'claude-3-5-sonnet',
            endpointId: 'endpoint-1',
          },
        },
      });

      expect(mockRepository.claimEventedResultContinuation).toHaveBeenCalledWith(
        'run-1',
        expect.any(Number)
      );
      expect(mockRepository.completeRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'success',
          tokens_used: 1000,
          time_seconds: 60,
          cost_usd: 0.01,
          context: expect.objectContaining({
            evented_dispatch: expect.objectContaining({
              execution_mode: 'evented',
              lane_id: 'main',
              result_continuation_applied: true,
            }),
          }),
        })
      );
      expect(mockQualityGateRunner.runVerification).toHaveBeenCalled();
      expect(mockLaneSelector.decrementActive).toHaveBeenCalledWith('main');
      expect(scheduler.getMetrics().currentActiveWorkItems).toBe(0);
    });

    it('should suppress duplicate execution.completed without reapplying continuation', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      const continuationSpy = jest.spyOn(scheduler as any, 'continueAfterExecutionResult');

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      const completedEvent: RuntimeEvent = {
        id: 'evt-dup-completed',
        type: 'execution.completed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          result: {
            runId: 'run-1',
            workItemId: 'wi-1',
            success: true,
            tokensUsed: 1000,
            timeSeconds: 60,
            costUsd: 0.01,
            artifacts: [],
          },
        },
      };

      await runtimeEventHandler!(completedEvent);

      mockRepository.getRun.mockReturnValue(
        createRun({
          id: 'run-1',
          status: 'success',
          context: {
            evented_dispatch: {
              execution_mode: 'evented',
              lane_id: 'main',
              dispatched_at: 1000,
              result_continuation_applied: true,
              result_continuation_applied_at: 2000,
            },
          },
        })
      );

      await runtimeEventHandler!(completedEvent);

      expect(continuationSpy).toHaveBeenCalledTimes(1);
      expect(mockRepository.completeRun).toHaveBeenCalledTimes(1);
      expect(mockRepository.claimEventedResultContinuation).toHaveBeenCalledTimes(1);
    });

    it('should route evented completion results through the shared post-execution continuation', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      const continuationSpy = jest.spyOn(scheduler as any, 'continueAfterExecutionResult');

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      await runtimeEventHandler!({
        id: 'evt-1b',
        type: 'execution.completed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          result: {
            runId: 'run-1',
            workItemId: 'wi-1',
            success: true,
            tokensUsed: 1000,
            timeSeconds: 60,
            costUsd: 0.01,
            artifacts: [],
          },
        },
      });

      expect(continuationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workItem,
          goal,
          run: expect.objectContaining({ id: 'run-1' }),
        }),
        expect.objectContaining({
          runId: 'run-1',
          workItemId: 'wi-1',
          success: true,
        }),
        { cleanupBeforeContinuation: true }
      );
    });

    it('should consume execution.failed as the authoritative evented failure signal and release lane state', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      expect(runtimeEventHandler).toBeDefined();
      expect(scheduler.getMetrics().currentActiveWorkItems).toBe(1);

      await runtimeEventHandler!({
        id: 'evt-2',
        type: 'execution.failed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          request: {
            runId: 'run-1',
            goalId: 'goal-1',
            workItemId: 'wi-1',
            workItem,
            model: 'claude-3-5-sonnet',
            laneId: 'main',
            budgetRemaining: mockBudgetTracker.getBudgetStatus(goal),
          },
          error: {
            code: 'WORKER_FAILED',
            message: 'worker execution failed',
            recoverable: true,
          },
        },
      });

      expect(mockRepository.completeRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failure',
          tokens_used: 0,
          time_seconds: 0,
          cost_usd: 0,
          error_message: 'worker execution failed',
        })
      );
      expect(mockLaneSelector.decrementActive).toHaveBeenCalledWith('main');
      expect(scheduler.getMetrics().currentActiveWorkItems).toBe(0);
      expect(mockWorkItemManager.updateStatus).toHaveBeenCalledWith('wi-1', 'failed');
    });

    it('should suppress duplicate execution.failed without reapplying continuation', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      const continuationSpy = jest.spyOn(scheduler as any, 'continueAfterExecutionResult');

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      const failedEvent: RuntimeEvent = {
        id: 'evt-dup-failed',
        type: 'execution.failed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          error: {
            code: 'WORKER_FAILED',
            message: 'worker execution failed',
            recoverable: true,
          },
        },
      };

      await runtimeEventHandler!(failedEvent);

      mockRepository.getRun.mockReturnValue(
        createRun({
          id: 'run-1',
          status: 'failure',
          context: {
            evented_dispatch: {
              execution_mode: 'evented',
              lane_id: 'main',
              dispatched_at: 1000,
              result_continuation_applied: true,
              result_continuation_applied_at: 2000,
            },
          },
        })
      );

      await runtimeEventHandler!(failedEvent);

      expect(continuationSpy).toHaveBeenCalledTimes(1);
      expect(mockRepository.completeRun).toHaveBeenCalledTimes(1);
      expect(mockRepository.claimEventedResultContinuation).toHaveBeenCalledTimes(1);
    });

    it('should record failure-side usage when execution.failed carries a full failed result', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      await runtimeEventHandler!({
        id: 'evt-2b',
        type: 'execution.failed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          error: {
            code: 'WORKER_FAILED',
            message: 'worker execution failed',
            recoverable: true,
          },
          result: {
            runId: 'run-1',
            goalId: 'goal-1',
            workItemId: 'wi-1',
            source: 'local-execution-worker',
            success: false,
            outcome: 'failure',
            tokensUsed: 321,
            timeSeconds: 12,
            costUsd: 0.07,
            artifacts: ['artifact-1'],
            endpointId: 'endpoint-2',
            error: {
              code: 'WORKER_FAILED',
              message: 'worker execution failed',
              recoverable: true,
            },
          },
        },
      });

      expect(mockBudgetTracker.recordUsage).toHaveBeenCalledWith('goal-1', 321, 0.2, 0.07);
      expect(mockRepository.completeRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failure',
          tokens_used: 321,
          time_seconds: 12,
          cost_usd: 0.07,
          artifacts: ['artifact-1'],
          error_message: 'worker execution failed',
          context: expect.objectContaining({
            endpoint_id: 'endpoint-2',
          }),
        })
      );
    });

    it('should ignore stale evented results after durable terminal state is already recorded', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      (scheduler as any).cleanupExecutionContext('run-1');
      mockRepository.getRun.mockReturnValue(
        createRun({
          id: 'run-1',
          status: 'failure',
          context: {
            evented_dispatch: {
              execution_mode: 'evented',
              lane_id: 'main',
              dispatched_at: 1000,
              result_continuation_applied: false,
            },
          },
        })
      );

      await runtimeEventHandler!({
        id: 'evt-stale-terminal',
        type: 'execution.failed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          error: {
            code: 'WORKER_FAILED',
            message: 'worker execution failed',
            recoverable: true,
          },
        },
      });

      expect(mockRepository.claimEventedResultContinuation).not.toHaveBeenCalled();
      expect(mockRepository.completeRun).not.toHaveBeenCalled();
      expect(mockWorkItemManager.updateStatus).not.toHaveBeenCalledWith('wi-1', 'failed');
    });

    it('should consume the local worker enriched failed result payload by default', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      scheduler = new SchedulerCore(mockDeps, { executionMode: 'evented' });

      await scheduler.submitGoal(goal);
      await scheduler.start();
      await scheduler.tick();

      await runtimeEventHandler!({
        id: 'evt-2c',
        type: 'execution.failed',
        source: 'local-execution-worker',
        timestamp: Date.now(),
        runId: 'run-1',
        goalId: 'goal-1',
        workItemId: 'wi-1',
        payload: {
          request: {
            runId: 'run-1',
            goalId: 'goal-1',
            workItemId: 'wi-1',
            workItem,
            model: 'claude-3-5-sonnet',
            laneId: 'main',
            budgetRemaining: mockBudgetTracker.getBudgetStatus(goal),
          },
          error: {
            code: 'WORKER_FAILED',
            message: 'worker execution failed',
            recoverable: true,
          },
          result: {
            runId: 'run-1',
            goalId: 'goal-1',
            workItemId: 'wi-1',
            source: 'local-execution-worker',
            success: false,
            outcome: 'failure',
            tokensUsed: 88,
            timeSeconds: 6,
            costUsd: 0.02,
            artifacts: [],
            actualModel: 'claude-3-5-sonnet',
            endpointId: 'endpoint-9',
            error: {
              code: 'WORKER_FAILED',
              message: 'worker execution failed',
              recoverable: true,
            },
          },
        },
      });

      expect(mockBudgetTracker.recordUsage).toHaveBeenCalledWith('goal-1', 88, 0.1, 0.02);
      expect(mockRepository.completeRun).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          status: 'failure',
          tokens_used: 88,
          time_seconds: 6,
          cost_usd: 0.02,
          error_message: 'worker execution failed',
          context: expect.objectContaining({
            actual_model: 'claude-3-5-sonnet',
            endpoint_id: 'endpoint-9',
          }),
        })
      );
    });

    it('should handle execution failure with retry', async () => {
      const goal = createGoal();
      const workItem = createWorkItem();
      mockRepository.getGoal.mockReturnValue(goal);
      mockWorkItemManager.getNextWorkItem.mockResolvedValueOnce(workItem).mockResolvedValue(null);
      mockExecutionPort.execute.mockResolvedValue({
        runId: 'run-1',
        workItemId: 'wi-1',
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
      mockExecutionPort.execute.mockResolvedValue({
        runId: 'run-1',
        workItemId: 'wi-1',
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
