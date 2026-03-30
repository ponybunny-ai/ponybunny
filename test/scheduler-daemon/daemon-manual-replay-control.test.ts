import os from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';

import type { IExecutionService } from '../../src/app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../../src/infra/llm/llm-provider.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { RuntimeToolingContext } from '../../src/runtime/tooling-context/index.js';
import { SchedulerDaemon } from '../../src/scheduler-daemon/daemon.js';

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

function createRepositoryMock(): IWorkOrderRepository {
  return {
    initialize: async () => {},
    close: () => {},
    createGoal: () => {
      throw new Error('not used');
    },
    getGoal: () => undefined,
    updateGoalStatus: () => {},
    updateGoalContext: () => {},
    deleteGoal: () => {},
    listGoals: () => [],
    createWorkItem: () => {
      throw new Error('not used');
    },
    getWorkItem: () => undefined,
    updateWorkItemStatus: () => {},
    getReadyWorkItems: () => [],
    getWorkItemsByGoal: () => [],
    createRun: () => {
      throw new Error('not used');
    },
    getRun: () => undefined,
    getRunInspection: () => undefined,
    precheckEventedManualReplay: () => {
      throw new Error('not used');
    },
    mergeRunContext: () => {},
    claimEventedResultContinuation: () => ({ status: 'run_not_found' }),
    startEventedManualReplay: () => ({ status: 'run_not_found' }),
    markEventedRunOrphaned: () => ({ status: 'run_not_found' }),
    markEventedRunRecoveryCandidate: () => ({ status: 'run_not_found' }),
    markEventedRunReplayCandidate: () => ({ status: 'run_not_found' }),
    clearEventedRunRecoveryCandidate: () => ({ status: 'run_not_found' }),
    completeRun: () => {},
    getRunsByWorkItem: () => [],
    listInFlightRunReconciliationCandidates: () => [],
    listEventedInFlightRunInspections: () => [],
    listEventedOrphanedRunInspections: () => [],
    getEventedRunReconciliationSummary: () => ({
      inFlightEvented: 0,
      staleOrphaned: 0,
      continuationApplied: 0,
      alreadyTerminal: 0,
    }),
    updateGoalSpending: () => {},
    incrementWorkItemRetry: () => {},
    updateWorkItemStatusIfDependenciesMet: () => {},
    getBlockedWorkItems: () => [],
    getRepeatedErrorSignatures: () => [],
    createArtifact: () => {
      throw new Error('not used');
    },
    createDecision: () => {
      throw new Error('not used');
    },
    createEscalation: () => {
      throw new Error('not used');
    },
    createContextPack: () => {
      throw new Error('not used');
    },
    getLatestContextPack: () => undefined,
    getDatabase: () => { throw new Error('not used'); },
    upsertCronJob: () => {
      throw new Error('not used');
    },
    getCronJob: () => undefined,
    listCronJobs: () => [],
    claimDueCronJobs: () => [],
    markCronJobInFlight: () => {},
    updateCronJobAfterOutcome: () => {},
    getOrCreateCronJobRun: () => {
      throw new Error('not used');
    },
    linkCronJobRunToGoal: () => {},
    updateCronJobRunStatus: () => {},
  };
}

describe('SchedulerDaemon replay control command', () => {
  test('routes replay_run through the live scheduler and returns the result', async () => {
    const daemon = new SchedulerDaemon(
      createRepositoryMock(),
      {} as IExecutionService,
      {} as ILLMProvider,
      {
        ipcSocketPath: path.join(os.tmpdir(), 'scheduler.sock'),
        controlSocketPath: path.join(os.tmpdir(), 'scheduler-control.sock'),
        dbPath: path.join(os.tmpdir(), 'scheduler.db'),
        executionMode: 'evented',
        runtimeToolingContext: createRuntimeToolingContextStub(),
      }
    );

    const replayRun = jest.fn(async () => ({
      status: 'replay_started',
      originalRun: { id: 'run-original' },
      replacementRun: { id: 'run-replacement' },
    }));
    (daemon as unknown as { scheduler: { replayRun: typeof replayRun } }).scheduler = {
      replayRun,
    };

    const responder = jest.fn(async () => {});
    await (daemon as any).handleSchedulerCommand(
      {
        requestId: 'req-1',
        command: 'replay_run',
        runId: 'run-original',
      },
      responder
    );

    expect(replayRun).toHaveBeenCalledWith('run-original');
    expect(responder).toHaveBeenCalledWith(
      'req-1',
      true,
      undefined,
      expect.objectContaining({
        status: 'replay_started',
        replacementRun: expect.objectContaining({ id: 'run-replacement' }),
      })
    );
  });

  test('rejects replay_run when runId is missing', async () => {
    const daemon = new SchedulerDaemon(
      createRepositoryMock(),
      {} as IExecutionService,
      {} as ILLMProvider,
      {
        ipcSocketPath: path.join(os.tmpdir(), 'scheduler.sock'),
        controlSocketPath: path.join(os.tmpdir(), 'scheduler-control.sock'),
        dbPath: path.join(os.tmpdir(), 'scheduler.db'),
        executionMode: 'evented',
        runtimeToolingContext: createRuntimeToolingContextStub(),
      }
    );

    (daemon as unknown as { scheduler: Record<string, unknown> }).scheduler = {};
    const responder = jest.fn(async () => {});

    await (daemon as any).handleSchedulerCommand(
      {
        requestId: 'req-2',
        command: 'replay_run',
      },
      responder
    );

    expect(responder).toHaveBeenCalledWith('req-2', false, 'runId is required for replay_run');
  });
});
