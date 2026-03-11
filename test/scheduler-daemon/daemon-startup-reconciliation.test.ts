import path from 'node:path';
import os from 'node:os';

import { jest } from '@jest/globals';

import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { IExecutionService } from '../../src/app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../../src/infra/llm/llm-provider.js';
import type { RuntimeToolingContext } from '../../src/runtime/tooling-context/index.js';
import { SchedulerDaemon } from '../../src/scheduler-daemon/daemon.js';
import { buildEventedDispatchCheckpoint } from '../../src/scheduler/evented-dispatch-checkpoint.js';

function createRuntimeToolingContextStub(): RuntimeToolingContext {
  return {
    toolProvider: {
      getToolDefinitions: () => [],
      getToolsForPhase: () => [],
    },
    getPromptProvider: () => ({
      generatePrompt: () => '',
    }),
  } as unknown as RuntimeToolingContext;
}

function createRepositoryMock(): jest.Mocked<IWorkOrderRepository> {
  return {
    initialize: jest.fn(async () => {}),
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
    mergeRunContext: jest.fn(),
    claimEventedResultContinuation: jest.fn(),
    markEventedRunOrphaned: jest.fn().mockReturnValue({ status: 'marked' }),
    completeRun: jest.fn(),
    getRunsByWorkItem: jest.fn().mockReturnValue([]),
    listInFlightRunReconciliationCandidates: jest.fn().mockReturnValue([]),
    appendRunEvent: jest.fn(),
    listRunEvents: jest.fn(),
    pruneRunEvents: jest.fn(),
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
  } as unknown as jest.Mocked<IWorkOrderRepository>;
}

describe('SchedulerDaemon startup reconciliation', () => {
  it('records a startup reconciliation summary in evented mode', async () => {
    const repository = createRepositoryMock();
    repository.listInFlightRunReconciliationCandidates.mockReturnValue([
      {
        run: {
          id: 'run-1',
          created_at: 1,
          work_item_id: 'wi-1',
          goal_id: 'goal-1',
          agent_type: 'code',
          run_sequence: 1,
          status: 'running',
          tokens_used: 0,
          cost_usd: 0,
          artifacts: [],
          context: {
            evented_dispatch: buildEventedDispatchCheckpoint({
              laneId: 'main',
              dispatchedAt: 1,
              resultContinuationApplied: false,
            }),
          },
        },
        workItemStatus: 'in_progress',
        workItemUpdatedAt: 1,
      },
    ]);

    const daemon = new SchedulerDaemon(
      repository,
      {} as IExecutionService,
      {} as ILLMProvider,
      {
        ipcSocketPath: path.join(os.tmpdir(), 'scheduler.sock'),
        dbPath: path.join(os.tmpdir(), 'scheduler.db'),
        executionMode: 'evented',
        runtimeToolingContext: createRuntimeToolingContextStub(),
      }
    );

    await (daemon as any).reconcileEventedInFlightRunsOnStartup();

    expect(repository.listInFlightRunReconciliationCandidates).toHaveBeenCalled();
    expect(repository.markEventedRunOrphaned).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ classification: 'stale_timeout' })
    );
    expect(daemon.getStartupReconciliationSummary()).toEqual(
      expect.objectContaining({
        scanned: 1,
        staleTimeoutExceeded: 1,
      })
    );
  });

  it('does not mark non-stale evented runs during startup reconciliation', async () => {
    const repository = createRepositoryMock();
    repository.listInFlightRunReconciliationCandidates.mockReturnValue([
      {
        run: {
          id: 'run-1',
          created_at: 1,
          work_item_id: 'wi-1',
          goal_id: 'goal-1',
          agent_type: 'code',
          run_sequence: 1,
          status: 'running',
          tokens_used: 0,
          cost_usd: 0,
          artifacts: [],
          context: {
            evented_dispatch: buildEventedDispatchCheckpoint({
              laneId: 'main',
              dispatchedAt: Date.now(),
              resultContinuationApplied: false,
            }),
          },
        },
        workItemStatus: 'in_progress',
        workItemUpdatedAt: 1,
      },
    ]);

    const daemon = new SchedulerDaemon(
      repository,
      {} as IExecutionService,
      {} as ILLMProvider,
      {
        ipcSocketPath: path.join(os.tmpdir(), 'scheduler.sock'),
        dbPath: path.join(os.tmpdir(), 'scheduler.db'),
        executionMode: 'evented',
        eventedOrphanTimeoutMs: 30 * 60 * 1000,
        runtimeToolingContext: createRuntimeToolingContextStub(),
      }
    );

    await (daemon as any).reconcileEventedInFlightRunsOnStartup();

    expect(repository.markEventedRunOrphaned).not.toHaveBeenCalled();
    expect(daemon.getStartupReconciliationSummary()).toEqual(
      expect.objectContaining({
        staleTimeoutExceeded: 0,
      })
    );
  });

  it('skips startup reconciliation in direct mode', async () => {
    const repository = createRepositoryMock();
    const daemon = new SchedulerDaemon(
      repository,
      {} as IExecutionService,
      {} as ILLMProvider,
      {
        ipcSocketPath: path.join(os.tmpdir(), 'scheduler.sock'),
        dbPath: path.join(os.tmpdir(), 'scheduler.db'),
        executionMode: 'direct',
        runtimeToolingContext: createRuntimeToolingContextStub(),
      }
    );

    await (daemon as any).reconcileEventedInFlightRunsOnStartup();

    expect(repository.listInFlightRunReconciliationCandidates).not.toHaveBeenCalled();
    expect(daemon.getStartupReconciliationSummary()).toBeNull();
  });
});
