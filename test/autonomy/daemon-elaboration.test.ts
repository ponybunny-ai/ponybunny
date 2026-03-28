import { AutonomyDaemon } from '../../src/autonomy/daemon.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type {
  IPlanningService,
  IExecutionService,
  IVerificationService,
  IEvaluationService,
  IElaborationService,
} from '../../src/app/lifecycle/stage-interfaces.js';
import type { Goal } from '../../src/work-order/types/index.js';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    created_at: 1,
    updated_at: 2,
    title: 'Test goal',
    description: 'A test goal for elaboration',
    success_criteria: [],
    status: 'queued',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    ...overrides,
  };
}

function makeMockRepository(): jest.Mocked<IWorkOrderRepository> {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    createGoal: jest.fn(),
    getGoal: jest.fn(),
    updateGoalStatus: jest.fn(),
    deleteGoal: jest.fn(),
    listGoals: jest.fn().mockReturnValue([]),
    createWorkItem: jest.fn(),
    getWorkItem: jest.fn(),
    updateWorkItemStatus: jest.fn(),
    getReadyWorkItems: jest.fn().mockReturnValue([]),
    getWorkItemsByGoal: jest.fn().mockReturnValue([]),
    createRun: jest.fn(),
    getRun: jest.fn(),
    getRunInspection: jest.fn(),
    precheckEventedManualReplay: jest.fn(),
    mergeRunContext: jest.fn(),
    claimEventedResultContinuation: jest.fn(),
    startEventedManualReplay: jest.fn(),
    markEventedRunOrphaned: jest.fn(),
    markEventedRunRecoveryCandidate: jest.fn(),
    markEventedRunReplayCandidate: jest.fn(),
    clearEventedRunRecoveryCandidate: jest.fn(),
    completeRun: jest.fn(),
    getRunsByWorkItem: jest.fn().mockReturnValue([]),
    listInFlightRunReconciliationCandidates: jest.fn().mockReturnValue([]),
    listEventedInFlightRunInspections: jest.fn().mockReturnValue([]),
    listEventedOrphanedRunInspections: jest.fn().mockReturnValue([]),
    getEventedRunReconciliationSummary: jest.fn(),
    updateGoalSpending: jest.fn(),
    incrementWorkItemRetry: jest.fn(),
    updateWorkItemStatusIfDependenciesMet: jest.fn(),
    getBlockedWorkItems: jest.fn().mockReturnValue([]),
    getRepeatedErrorSignatures: jest.fn().mockReturnValue([]),
    createArtifact: jest.fn(),
    createDecision: jest.fn(),
    createEscalation: jest.fn(),
    createContextPack: jest.fn(),
    upsertCronJob: jest.fn(),
    getCronJob: jest.fn(),
    listCronJobs: jest.fn().mockReturnValue([]),
    claimDueCronJobs: jest.fn().mockReturnValue([]),
    markCronJobInFlight: jest.fn(),
    updateCronJobAfterOutcome: jest.fn(),
    getOrCreateCronJobRun: jest.fn(),
    linkCronJobRunToGoal: jest.fn(),
    updateCronJobRunStatus: jest.fn(),
  } as jest.Mocked<IWorkOrderRepository>;
}

function makeMockPlanningService(): jest.Mocked<IPlanningService> {
  return {
    planWorkItems: jest.fn().mockResolvedValue({ workItems: [], dependencies: new Map() }),
  };
}

function makeMockExecutionService(): jest.Mocked<IExecutionService> {
  return {
    executeWorkItem: jest.fn(),
  };
}

function makeMockVerificationService(): jest.Mocked<IVerificationService> {
  return {
    verifyWorkItem: jest.fn(),
  };
}

function makeMockEvaluationService(): jest.Mocked<IEvaluationService> {
  return {
    evaluateRun: jest.fn(),
  };
}

function makeMockElaborationService(): jest.Mocked<IElaborationService> {
  return {
    elaborateGoal: jest.fn(),
  };
}

const DEFAULT_CONFIG = {
  maxConcurrentRuns: 2,
  pollingIntervalMs: 1000,
};

describe('AutonomyDaemon elaboration integration', () => {
  let repository: jest.Mocked<IWorkOrderRepository>;
  let planningService: jest.Mocked<IPlanningService>;
  let executionService: jest.Mocked<IExecutionService>;
  let verificationService: jest.Mocked<IVerificationService>;
  let evaluationService: jest.Mocked<IEvaluationService>;
  let elaborationService: jest.Mocked<IElaborationService>;

  beforeEach(() => {
    repository = makeMockRepository();
    planningService = makeMockPlanningService();
    executionService = makeMockExecutionService();
    verificationService = makeMockVerificationService();
    evaluationService = makeMockEvaluationService();
    elaborationService = makeMockElaborationService();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('proceeds to planning when elaborationService returns no escalations', async () => {
    const goal = makeGoal();
    repository.listGoals.mockReturnValue([goal]);

    elaborationService.elaborateGoal.mockResolvedValue({
      goal,
      clarifications: [],
      escalations: [],
    });

    const daemon = new AutonomyDaemon(
      repository, planningService, executionService,
      verificationService, evaluationService, DEFAULT_CONFIG,
      elaborationService,
    );

    await (daemon as any).processQueuedGoals();

    expect(elaborationService.elaborateGoal).toHaveBeenCalledWith(goal);
    expect(planningService.planWorkItems).toHaveBeenCalledWith(goal);
  });

  it('skips planning when elaborationService returns escalations', async () => {
    const goal = makeGoal();
    repository.listGoals.mockReturnValue([goal]);

    elaborationService.elaborateGoal.mockResolvedValue({
      goal,
      clarifications: [],
      escalations: ['Ambiguous requirement: define scope boundary'],
    });

    const daemon = new AutonomyDaemon(
      repository, planningService, executionService,
      verificationService, evaluationService, DEFAULT_CONFIG,
      elaborationService,
    );

    await (daemon as any).processQueuedGoals();

    expect(elaborationService.elaborateGoal).toHaveBeenCalledWith(goal);
    expect(planningService.planWorkItems).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Elaboration escalated goal goal-1'),
    );
  });

  it('goes straight to planning when elaborationService is not provided', async () => {
    const goal = makeGoal();
    repository.listGoals.mockReturnValue([goal]);

    const daemon = new AutonomyDaemon(
      repository, planningService, executionService,
      verificationService, evaluationService, DEFAULT_CONFIG,
      /* no elaborationService */
    );

    await (daemon as any).processQueuedGoals();

    expect(planningService.planWorkItems).toHaveBeenCalledWith(goal);
  });

  it('handles elaborationService errors gracefully without crashing the cycle', async () => {
    const goal1 = makeGoal({ id: 'goal-1', title: 'First goal' });
    const goal2 = makeGoal({ id: 'goal-2', title: 'Second goal' });
    repository.listGoals.mockReturnValue([goal1, goal2]);

    elaborationService.elaborateGoal
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce({
        goal: goal2,
        clarifications: [],
        escalations: [],
      });

    const daemon = new AutonomyDaemon(
      repository, planningService, executionService,
      verificationService, evaluationService, DEFAULT_CONFIG,
      elaborationService,
    );

    await (daemon as any).processQueuedGoals();

    // First goal fails elaboration, so planning is skipped for it
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to plan goal goal-1'),
      expect.any(Error),
    );
    // Second goal should still be elaborated and planned
    expect(planningService.planWorkItems).toHaveBeenCalledWith(goal2);
    expect(planningService.planWorkItems).toHaveBeenCalledTimes(1);
  });

  it('logs clarifications but does not block planning', async () => {
    const goal = makeGoal();
    repository.listGoals.mockReturnValue([goal]);

    elaborationService.elaborateGoal.mockResolvedValue({
      goal,
      clarifications: [
        'Consider edge case: empty input',
        'Assumption: UTF-8 encoding',
      ],
      escalations: [],
    });

    const daemon = new AutonomyDaemon(
      repository, planningService, executionService,
      verificationService, evaluationService, DEFAULT_CONFIG,
      elaborationService,
    );

    await (daemon as any).processQueuedGoals();

    // Clarifications are logged
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Elaboration clarifications for goal goal-1'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Consider edge case: empty input'),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Assumption: UTF-8 encoding'),
    );

    // Planning still proceeds
    expect(planningService.planWorkItems).toHaveBeenCalledWith(goal);
  });
});
