import os from 'node:os';
import path from 'node:path';

import { jest } from '@jest/globals';

import type { IExecutionService } from '../../src/app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../../src/infra/llm/llm-provider.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { RuntimeToolingContext } from '../../src/runtime/tooling-context/index.js';
import type { GoalEvaluationReport } from '../../src/harness/post-goal-evaluator.js';
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
    createGoal: () => { throw new Error('not used'); },
    getGoal: () => undefined,
    updateGoalStatus: () => {},
    deleteGoal: () => {},
    listGoals: () => [],
    createWorkItem: () => { throw new Error('not used'); },
    getWorkItem: () => undefined,
    updateWorkItemStatus: () => {},
    getReadyWorkItems: () => [],
    getWorkItemsByGoal: () => [],
    createRun: () => { throw new Error('not used'); },
    getRun: () => undefined,
    getRunInspection: () => undefined,
    precheckEventedManualReplay: () => { throw new Error('not used'); },
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
    createArtifact: () => { throw new Error('not used'); },
    createDecision: () => { throw new Error('not used'); },
    createEscalation: () => { throw new Error('not used'); },
    createContextPack: () => { throw new Error('not used'); },
    getLatestContextPack: () => undefined,
    getDatabase: () => { throw new Error('not used'); },
    upsertCronJob: () => { throw new Error('not used'); },
    getCronJob: () => undefined,
    listCronJobs: () => [],
    claimDueCronJobs: () => [],
    markCronJobInFlight: () => {},
    updateCronJobAfterOutcome: () => {},
    getOrCreateCronJobRun: () => { throw new Error('not used'); },
    linkCronJobRunToGoal: () => {},
    updateCronJobRunStatus: () => {},
  };
}

function makeReport(goalId: string, timestamp = Date.now()): GoalEvaluationReport {
  return {
    goalId,
    timestamp,
    trigger: 'goal_completed',
    workItemResults: [],
    summary: { total: 0, publish: 0, retry: 0, replan: 0, escalate: 0, skipped: 0 },
    unactionableDecisions: [],
  };
}

function createDaemon(): SchedulerDaemon {
  return new SchedulerDaemon(
    createRepositoryMock(),
    {} as IExecutionService,
    {} as ILLMProvider,
    {
      ipcSocketPath: path.join(os.tmpdir(), `pony-eval-test-${Date.now()}.sock`),
      controlSocketPath: path.join(os.tmpdir(), `pony-eval-ctrl-${Date.now()}.sock`),
      dbPath: path.join(os.tmpdir(), `pony-eval-test-${Date.now()}.db`),
      executionMode: 'evented',
      runtimeToolingContext: createRuntimeToolingContextStub(),
    }
  );
}

describe('SchedulerDaemon evaluation_list command', () => {
  test('returns empty array when postGoalEvaluator is null', async () => {
    const daemon = createDaemon();
    // Provide a scheduler so the command handler does not short-circuit
    (daemon as unknown as { scheduler: Record<string, unknown> }).scheduler = {};
    // postGoalEvaluator is null by default

    const responder = jest.fn(async () => {});
    await (daemon as any).handleSchedulerCommand(
      { requestId: 'req-1', command: 'evaluation_list' },
      responder
    );

    expect(responder).toHaveBeenCalledWith('req-1', true, undefined, { reports: [] });
  });

  test('returns all reports when no filters provided', async () => {
    const daemon = createDaemon();
    (daemon as unknown as { scheduler: Record<string, unknown> }).scheduler = {};

    const reports = [makeReport('goal-1'), makeReport('goal-2')];
    (daemon as unknown as { postGoalEvaluator: { getReports: (opts?: { goalId?: string; limit?: number }) => GoalEvaluationReport[] } }).postGoalEvaluator = {
      getReports: (opts?: { goalId?: string; limit?: number }) => {
        let result = [...reports];
        if (opts?.goalId) result = result.filter(r => r.goalId === opts.goalId);
        if (opts?.limit) result = result.slice(-opts.limit);
        return result;
      },
    };

    const responder = jest.fn(async () => {});
    await (daemon as any).handleSchedulerCommand(
      { requestId: 'req-2', command: 'evaluation_list' },
      responder
    );

    expect(responder).toHaveBeenCalledWith('req-2', true, undefined, { reports });
  });

  test('filters reports by goalId', async () => {
    const daemon = createDaemon();
    (daemon as unknown as { scheduler: Record<string, unknown> }).scheduler = {};

    const reports = [makeReport('goal-1'), makeReport('goal-2'), makeReport('goal-1')];
    (daemon as unknown as { postGoalEvaluator: { getReports: (opts?: { goalId?: string; limit?: number }) => GoalEvaluationReport[] } }).postGoalEvaluator = {
      getReports: (opts?: { goalId?: string; limit?: number }) => {
        let result = [...reports];
        if (opts?.goalId) result = result.filter(r => r.goalId === opts.goalId);
        if (opts?.limit) result = result.slice(-opts.limit);
        return result;
      },
    };

    const responder = jest.fn(async () => {});
    await (daemon as any).handleSchedulerCommand(
      { requestId: 'req-3', command: 'evaluation_list', goalId: 'goal-1' },
      responder
    );

    const args = responder.mock.calls[0] as unknown as unknown[];
    const result = args[3] as { reports: GoalEvaluationReport[] };
    expect(result.reports).toHaveLength(2);
    expect(result.reports.every(r => r.goalId === 'goal-1')).toBe(true);
  });

  test('applies limit (takes last N reports)', async () => {
    const daemon = createDaemon();
    (daemon as unknown as { scheduler: Record<string, unknown> }).scheduler = {};

    const reports = [
      makeReport('goal-1', 1000),
      makeReport('goal-2', 2000),
      makeReport('goal-3', 3000),
    ];
    (daemon as unknown as { postGoalEvaluator: { getReports: (opts?: { goalId?: string; limit?: number }) => GoalEvaluationReport[] } }).postGoalEvaluator = {
      getReports: (opts?: { goalId?: string; limit?: number }) => {
        let result = [...reports];
        if (opts?.goalId) result = result.filter(r => r.goalId === opts.goalId);
        if (opts?.limit) result = result.slice(-opts.limit);
        return result;
      },
    };

    const responder = jest.fn(async () => {});
    await (daemon as any).handleSchedulerCommand(
      { requestId: 'req-4', command: 'evaluation_list', limit: 2 },
      responder
    );

    const args = responder.mock.calls[0] as unknown as unknown[];
    const result = args[3] as { reports: GoalEvaluationReport[] };
    expect(result.reports).toHaveLength(2);
    // slice(-2) takes the last 2 — goal-2 and goal-3
    expect(result.reports[0]!.goalId).toBe('goal-2');
    expect(result.reports[1]!.goalId).toBe('goal-3');
  });

  test('applies default limit of 50', async () => {
    const daemon = createDaemon();
    (daemon as unknown as { scheduler: Record<string, unknown> }).scheduler = {};

    // Create 60 reports
    const reports = Array.from({ length: 60 }, (_, i) => makeReport(`goal-${i}`, i));
    (daemon as unknown as { postGoalEvaluator: { getReports: (opts?: { goalId?: string; limit?: number }) => GoalEvaluationReport[] } }).postGoalEvaluator = {
      getReports: (opts?: { goalId?: string; limit?: number }) => {
        let result = [...reports];
        if (opts?.goalId) result = result.filter(r => r.goalId === opts.goalId);
        if (opts?.limit) result = result.slice(-opts.limit);
        return result;
      },
    };

    const responder = jest.fn(async () => {});
    await (daemon as any).handleSchedulerCommand(
      { requestId: 'req-5', command: 'evaluation_list' },
      responder
    );

    const args = responder.mock.calls[0] as unknown as unknown[];
    const result = args[3] as { reports: GoalEvaluationReport[] };
    expect(result.reports).toHaveLength(50);
    // Should be the last 50 (indices 10-59)
    expect(result.reports[0]!.goalId).toBe('goal-10');
  });
});
