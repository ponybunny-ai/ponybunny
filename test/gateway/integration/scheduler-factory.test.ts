/**
 * Scheduler Factory Tests
 */

import { createScheduler } from '../../../src/gateway/integration/scheduler-factory.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { IExecutionService } from '../../../src/app/lifecycle/stage-interfaces.js';
import type { ExecutionPort } from '../../../src/runtime/execution-boundary/index.js';
import type { EventBus as RuntimeEventBus } from '../../../src/runtime/event-bus/index.js';
import type { Goal, Run, WorkItem } from '../../../src/work-order/types/index.js';

describe('createScheduler', () => {
  let mockRepository: IWorkOrderRepository;
  let mockExecutionService: IExecutionService;
  let mockExecutionPort: jest.Mocked<ExecutionPort>;
  let mockRuntimeEventBus: jest.Mocked<RuntimeEventBus>;

  beforeEach(() => {
    // Create mock repository
    mockRepository = {
      initialize: jest.fn(),
      close: jest.fn(),
      createGoal: jest.fn(),
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
      listGoals: jest.fn(),
      createWorkItem: jest.fn(),
      getWorkItem: jest.fn(),
      updateWorkItemStatus: jest.fn(),
      getReadyWorkItems: jest.fn().mockReturnValue([]),
      getWorkItemsByGoal: jest.fn().mockReturnValue([]),
      createRun: jest.fn().mockReturnValue({
        id: 'run-1',
        work_item_id: 'wi-1',
        goal_id: 'goal-1',
        agent_type: 'default',
        run_sequence: 1,
        status: 'running',
        created_at: Date.now(),
        tokens_used: 0,
        cost_usd: 0,
        artifacts: [],
      } satisfies Run),
      getRun: jest.fn(),
      completeRun: jest.fn(),
      getRunsByWorkItem: jest.fn().mockReturnValue([]),
      updateGoalSpending: jest.fn(),
      incrementWorkItemRetry: jest.fn(),
      updateWorkItemStatusIfDependenciesMet: jest.fn(),
      getBlockedWorkItems: jest.fn().mockReturnValue([]),
      getRepeatedErrorSignatures: jest.fn().mockReturnValue([]),
      createArtifact: jest.fn(),
      createDecision: jest.fn(),
      createEscalation: jest.fn().mockReturnValue({
        id: 'esc-1',
        work_item_id: 'wi-1',
        goal_id: 'goal-1',
        escalation_type: 'stuck',
        severity: 'medium',
        status: 'open',
        title: 'Test',
        description: 'Test escalation',
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
      createContextPack: jest.fn(),
      mergeRunContext: jest.fn(),
      precheckEventedManualReplay: jest.fn().mockReturnValue({ status: 'ok' }),
      claimEventedResultContinuation: jest.fn().mockReturnValue({ status: 'claimed' }),
      startEventedManualReplay: jest.fn().mockReturnValue({ status: 'started' }),
      listInFlightRunReconciliationCandidates: jest.fn().mockReturnValue([]),
    } as unknown as IWorkOrderRepository;

    // Create mock execution service
    mockExecutionService = {
      executeWorkItem: jest.fn().mockResolvedValue({
        run: {
          id: 'run-1',
          work_item_id: 'wi-1',
          goal_id: 'goal-1',
          agent_type: 'default',
          run_sequence: 1,
          status: 'success',
          created_at: Date.now(),
          tokens_used: 100,
          time_seconds: 10,
          cost_usd: 0.01,
          artifacts: [],
        } satisfies Run,
        success: true,
        needsRetry: false,
      }),
    } as unknown as IExecutionService;

    mockExecutionPort = {
      execute: jest.fn().mockResolvedValue({
        runId: 'run-1',
        workItemId: 'wi-1',
        success: true,
        tokensUsed: 0,
        timeSeconds: 0,
        costUsd: 0,
        artifacts: [],
      }),
      abort: jest.fn().mockResolvedValue(undefined),
    };

    mockRuntimeEventBus = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
      subscribeAll: jest.fn().mockReturnValue(() => {}),
    };
  });

  it('should create a scheduler with default config', () => {
    const scheduler = createScheduler({
      repository: mockRepository,
      executionService: mockExecutionService,
    });

    expect(scheduler).toBeDefined();
    expect(scheduler.getState).toBeDefined();
    expect(scheduler.start).toBeDefined();
    expect(scheduler.stop).toBeDefined();
    expect(scheduler.submitGoal).toBeDefined();
  });

  it('should create a scheduler with custom config', () => {
    const scheduler = createScheduler(
      {
        repository: mockRepository,
        executionService: mockExecutionService,
      },
      {
        tickIntervalMs: 500,
        maxConcurrentGoals: 10,
        autoStart: true,
        debug: true,
      }
    );

    expect(scheduler).toBeDefined();
  });

  it('should have idle state initially', () => {
    const scheduler = createScheduler({
      repository: mockRepository,
      executionService: mockExecutionService,
    });

    const state = scheduler.getState();
    expect(state.status).toBe('idle');
    expect(state.activeGoals).toEqual([]);
    expect(state.errorCount).toBe(0);
  });

  it('should be able to start and stop', async () => {
    const scheduler = createScheduler({
      repository: mockRepository,
      executionService: mockExecutionService,
    });

    await scheduler.start();
    expect(scheduler.getState().status).toBe('running');

    await scheduler.stop();
    expect(scheduler.getState().status).toBe('stopped');
  });

  it('should accept goal submissions', async () => {
    const scheduler = createScheduler({
      repository: mockRepository,
      executionService: mockExecutionService,
    });

    const goal: Goal = {
      id: 'goal-1',
      title: 'Test Goal',
      description: 'A test goal',
      status: 'queued',
      priority: 1,
      success_criteria: [{
        description: 'Test passes',
        type: 'deterministic',
        verification_method: 'npm test',
        required: true,
      }],
      created_at: Date.now(),
      updated_at: Date.now(),
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
    };

    await scheduler.submitGoal(goal);

    const state = scheduler.getState();
    expect(state.activeGoals).toContain('goal-1');
  });

  it('should emit events when goals are submitted', async () => {
    const scheduler = createScheduler({
      repository: mockRepository,
      executionService: mockExecutionService,
    });

    const events: unknown[] = [];
    scheduler.on((event) => {
      events.push(event);
    });

    const goal: Goal = {
      id: 'goal-1',
      title: 'Test Goal',
      description: 'A test goal',
      status: 'queued',
      priority: 1,
      success_criteria: [{
        description: 'Test passes',
        type: 'deterministic',
        verification_method: 'npm test',
        required: true,
      }],
      created_at: Date.now(),
      updated_at: Date.now(),
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
    };

    await scheduler.submitGoal(goal);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({
      type: 'goal_started',
      goalId: 'goal-1',
    });
  });

  it('should track metrics', () => {
    const scheduler = createScheduler({
      repository: mockRepository,
      executionService: mockExecutionService,
    });

    const metrics = scheduler.getMetrics();

    expect(metrics).toMatchObject({
      totalGoalsProcessed: 0,
      totalWorkItemsCompleted: 0,
      totalRunsExecuted: 0,
      currentActiveGoals: 0,
      currentActiveWorkItems: 0,
    });
  });

  it('should wire evented execution mode through the factory', async () => {
    const goal: Goal = {
      id: 'goal-1',
      title: 'Test Goal',
      description: 'A test goal',
      status: 'queued',
      priority: 1,
      success_criteria: [],
      created_at: Date.now(),
      updated_at: Date.now(),
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
    };
    const workItem: WorkItem = {
      id: 'wi-1',
      goal_id: 'goal-1',
      title: 'Test Work Item',
      description: 'A test work item',
      item_type: 'code',
      status: 'ready',
      priority: 1,
      dependencies: [],
      blocks: [],
      estimated_effort: 'M',
      created_at: Date.now(),
      updated_at: Date.now(),
      retry_count: 0,
      max_retries: 3,
      verification_status: 'not_started',
    };
    let currentWorkItem = { ...workItem };

    (mockRepository.getGoal as jest.Mock).mockReturnValue(goal);
    (mockRepository.getReadyWorkItems as jest.Mock).mockImplementation(() =>
      currentWorkItem.status === 'ready' ? [currentWorkItem] : []
    );
    (mockRepository.getWorkItemsByGoal as jest.Mock).mockImplementation(() => [currentWorkItem]);
    (mockRepository.getWorkItem as jest.Mock).mockImplementation((id: string) =>
      id === currentWorkItem.id ? currentWorkItem : undefined
    );
    (mockRepository.updateWorkItemStatus as jest.Mock).mockImplementation((id: string, status: WorkItem['status']) => {
      if (id === currentWorkItem.id) {
        currentWorkItem = { ...currentWorkItem, status };
      }
    });

    const scheduler = createScheduler(
      {
        repository: mockRepository,
        executionService: mockExecutionService,
        executionPort: mockExecutionPort,
        runtimeEventBus: mockRuntimeEventBus,
      },
      {
        executionMode: 'evented',
      }
    );

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
      })
    );
    expect(mockExecutionPort.execute).not.toHaveBeenCalled();

    await scheduler.stop();
  });
});
