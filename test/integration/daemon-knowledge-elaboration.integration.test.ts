/**
 * Integration test: AutonomyDaemon lifecycle with real ElaborationService + GlobalKnowledgeService
 *
 * Proves that when AutonomyDaemon processes queued goals, ElaborationService is invoked
 * with a real GlobalKnowledgeService connected to the same DB, and pitfalls from
 * global_knowledge are surfaced as clarifications before planning proceeds.
 *
 * Real: GlobalKnowledgeService, ElaborationService, SQLite DB
 * Mocked: PlanningService, ExecutionService, VerificationService, EvaluationService, Repository (for goal listing)
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { AutonomyDaemon } from '../../src/autonomy/daemon.js';
import { ElaborationService } from '../../src/app/lifecycle/elaboration/elaboration-service.js';
import { GlobalKnowledgeService } from '../../src/domain/knowledge/global-knowledge-service.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type {
  IPlanningService,
  IExecutionService,
  IVerificationService,
  IEvaluationService,
} from '../../src/app/lifecycle/stage-interfaces.js';
import type { Goal } from '../../src/work-order/types/index.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = path.join(process.cwd(), 'src', 'infra', 'persistence', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

function makeGoal(overrides?: Partial<Goal>): Goal {
  return {
    id: 'goal-daemon-1',
    title: 'Daemon Integration Test Goal',
    description: 'A sufficiently long goal description that exceeds the fifty character minimum threshold for elaboration',
    status: 'queued',
    created_at: Date.now(),
    updated_at: Date.now(),
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    success_criteria: [
      { description: 'Tests pass', type: 'deterministic', verification_method: 'npm test', required: true },
    ],
    priority: 50,
    budget_tokens: 100000,
    ...overrides,
  };
}

function makeMockRepository(goals: Goal[] = []): jest.Mocked<IWorkOrderRepository> {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    createGoal: jest.fn(),
    getGoal: jest.fn(),
    updateGoalStatus: jest.fn(),
    deleteGoal: jest.fn(),
    listGoals: jest.fn().mockImplementation((filter?: { status?: string }) => {
      if (filter?.status === 'queued') return goals.filter(g => g.status === 'queued');
      return goals;
    }),
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

const DEFAULT_CONFIG = { maxConcurrentRuns: 2, pollingIntervalMs: 1000 };

describe('Integration: AutonomyDaemon lifecycle with real elaboration + knowledge', () => {
  let db: Database.Database;
  let knowledgeService: GlobalKnowledgeService;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    db = createDb();
    knowledgeService = new GlobalKnowledgeService(db);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    db.close();
    jest.restoreAllMocks();
  });

  test('queued goal receives pitfall clarifications from real GlobalKnowledgeService before planning', async () => {
    // Record a pitfall in the real DB
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Never bypass elaboration in the gateway path',
      confidence: 0.9,
    });

    const goal = makeGoal();
    const repository = makeMockRepository([goal]);

    // Real ElaborationService with real GlobalKnowledgeService (shared DB)
    const elaborationService = new ElaborationService(
      repository as IWorkOrderRepository,
      knowledgeService,
    );

    const planningService: jest.Mocked<IPlanningService> = {
      planWorkItems: jest.fn().mockResolvedValue({ workItems: [], dependencies: new Map() }),
    };

    const daemon = new AutonomyDaemon(
      repository,
      planningService,
      { executeWorkItem: jest.fn() } as unknown as IExecutionService,
      { verifyWorkItem: jest.fn() } as unknown as IVerificationService,
      { evaluateRun: jest.fn() } as unknown as IEvaluationService,
      DEFAULT_CONFIG,
      elaborationService,
    );

    await (daemon as any).processQueuedGoals();

    // Verify pitfall was surfaced in clarifications (logged by daemon)
    const logCalls = logSpy.mock.calls.map((c: unknown[]) => c.join(' '));
    const pitfallLog = logCalls.find((l: string) => l.includes('Never bypass elaboration'));
    expect(pitfallLog).toBeDefined();

    // Planning should still proceed (no escalations)
    expect(planningService.planWorkItems).toHaveBeenCalledWith(goal);
  });

  test('queued goal without success criteria escalates and skips planning', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Some pitfall that should not matter here',
      confidence: 0.8,
    });

    const goal = makeGoal({
      id: 'goal-no-criteria',
      success_criteria: [],
    });
    const repository = makeMockRepository([goal]);

    const elaborationService = new ElaborationService(
      repository as IWorkOrderRepository,
      knowledgeService,
    );

    const planningService: jest.Mocked<IPlanningService> = {
      planWorkItems: jest.fn().mockResolvedValue({ workItems: [], dependencies: new Map() }),
    };

    const daemon = new AutonomyDaemon(
      repository,
      planningService,
      { executeWorkItem: jest.fn() } as unknown as IExecutionService,
      { verifyWorkItem: jest.fn() } as unknown as IVerificationService,
      { evaluateRun: jest.fn() } as unknown as IEvaluationService,
      DEFAULT_CONFIG,
      elaborationService,
    );

    await (daemon as any).processQueuedGoals();

    // Elaboration should have escalated (no success criteria)
    expect(repository.createEscalation).toHaveBeenCalled();
    // Planning should NOT have been called
    expect(planningService.planWorkItems).not.toHaveBeenCalled();
  });

  test('multiple queued goals are each elaborated with real knowledge injection', async () => {
    knowledgeService.record({
      knowledge_type: 'pitfall',
      content: 'Shared pitfall across all goals',
      confidence: 0.7,
    });

    const goal1 = makeGoal({ id: 'goal-multi-1', title: 'First multi goal' });
    const goal2 = makeGoal({ id: 'goal-multi-2', title: 'Second multi goal' });
    const repository = makeMockRepository([goal1, goal2]);

    const elaborationService = new ElaborationService(
      repository as IWorkOrderRepository,
      knowledgeService,
    );

    const planningService: jest.Mocked<IPlanningService> = {
      planWorkItems: jest.fn().mockResolvedValue({ workItems: [], dependencies: new Map() }),
    };

    const daemon = new AutonomyDaemon(
      repository,
      planningService,
      { executeWorkItem: jest.fn() } as unknown as IExecutionService,
      { verifyWorkItem: jest.fn() } as unknown as IVerificationService,
      { evaluateRun: jest.fn() } as unknown as IEvaluationService,
      DEFAULT_CONFIG,
      elaborationService,
    );

    await (daemon as any).processQueuedGoals();

    // Both goals should have been planned
    expect(planningService.planWorkItems).toHaveBeenCalledTimes(2);
    expect(planningService.planWorkItems).toHaveBeenCalledWith(goal1);
    expect(planningService.planWorkItems).toHaveBeenCalledWith(goal2);

    // Both should have received the pitfall clarification
    const logCalls = logSpy.mock.calls.map((c: unknown[]) => c.join(' '));
    const pitfallLogs = logCalls.filter((l: string) => l.includes('Shared pitfall across all goals'));
    expect(pitfallLogs.length).toBeGreaterThanOrEqual(2);
  });
});
