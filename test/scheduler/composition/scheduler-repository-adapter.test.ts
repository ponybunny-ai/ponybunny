import { SchedulerRepositoryAdapter as GatewaySchedulerRepositoryAdapter } from '../../../src/gateway/integration/scheduler-repository-adapter.js';
import { SchedulerRepositoryAdapter } from '../../../src/scheduler/composition/scheduler-repository-adapter.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { Goal, Run, WorkItem } from '../../../src/work-order/types/index.js';

describe('SchedulerRepositoryAdapter boundary placement', () => {
  let mockRepository: jest.Mocked<IWorkOrderRepository>;

  beforeEach(() => {
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
      createRun: jest.fn(),
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
      createEscalation: jest.fn(),
      createContextPack: jest.fn(),
      precheckEventedManualReplay: jest.fn(),
      mergeRunContext: jest.fn(),
      claimEventedResultContinuation: jest.fn(),
      startEventedManualReplay: jest.fn(),
      listInFlightRunReconciliationCandidates: jest.fn().mockReturnValue([]),
      getOpenRuns: jest.fn(),
      updateRunStatus: jest.fn(),
      createMcpServer: jest.fn(),
      listMcpServers: jest.fn(),
      getMcpServer: jest.fn(),
      updateMcpServer: jest.fn(),
      deleteMcpServer: jest.fn(),
      checkDatabaseHealth: jest.fn(),
      getDashboardMetrics: jest.fn(),
      listAuditLogs: jest.fn(),
      createPermission: jest.fn(),
      getPermissionsByResource: jest.fn(),
      revokePermission: jest.fn(),
      getArtifactsByGoal: jest.fn(),
      getArtifactsByWorkItem: jest.fn(),
      getDecisionsByGoal: jest.fn(),
      getContextPacksByGoal: jest.fn(),
      exportGoal: jest.fn(),
      importGoal: jest.fn(),
      getRunInspection: jest.fn(),
      listGoalEventDispatchRecords: jest.fn(),
    } as unknown as jest.Mocked<IWorkOrderRepository>;
  });

  it('keeps the gateway path as a compatibility re-export of the scheduler-owned adapter', () => {
    expect(GatewaySchedulerRepositoryAdapter).toBe(SchedulerRepositoryAdapter);
  });

  it('preserves ready-item lookup behavior on the scheduler-owned adapter', () => {
    const goalId = 'goal-1';
    const readyWorkItem: WorkItem = {
      id: 'wi-1',
      goal_id: goalId,
      title: 'Ready item',
      description: 'ready',
      item_type: 'code',
      status: 'ready',
      priority: 1,
      dependencies: [],
      blocks: [],
      estimated_effort: 'S',
      created_at: 1,
      updated_at: 1,
      retry_count: 0,
      max_retries: 3,
      verification_status: 'not_started',
    };
    mockRepository.getReadyWorkItems.mockReturnValue([readyWorkItem]);

    const adapter = new SchedulerRepositoryAdapter(mockRepository);

    expect(adapter.getWorkItemsForGoal(goalId)).toEqual([readyWorkItem]);
    expect(mockRepository.getReadyWorkItems).toHaveBeenCalledWith(goalId);
    expect(mockRepository.getWorkItemsByGoal).not.toHaveBeenCalled();
  });

  it('continues delegating goal and run methods without changing semantics', () => {
    const goal: Goal = {
      id: 'goal-1',
      title: 'Goal',
      description: 'Goal',
      status: 'queued',
      priority: 1,
      success_criteria: [],
      created_at: 1,
      updated_at: 1,
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
    };
    const run: Run = {
      id: 'run-1',
      work_item_id: 'wi-1',
      goal_id: goal.id,
      agent_type: 'default',
      run_sequence: 1,
      status: 'running',
      created_at: 1,
      tokens_used: 0,
      cost_usd: 0,
      artifacts: [],
    };
    mockRepository.getGoal.mockReturnValue(goal);
    mockRepository.getRun.mockReturnValue(run);

    const adapter = new SchedulerRepositoryAdapter(mockRepository);

    expect(adapter.getGoal(goal.id)).toBe(goal);
    expect(adapter.getRun(run.id)).toBe(run);
  });
});
