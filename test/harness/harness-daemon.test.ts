/**
 * HarnessDaemon Unit Tests — ADR-001 Phase 1
 *
 * Tests HarnessDaemon polling and concurrency gating with mocked GoalHarness.
 */

import { HarnessDaemon } from '../../src/harness/harness-daemon.js';
import type { IGoalHarness, GoalHarnessResult } from '../../src/harness/goal-harness-interface.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { PostGoalEvaluator } from '../../src/harness/post-goal-evaluator.js';
import type { Goal } from '../../src/work-order/types/index.js';

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

function makeHarnessResult(overrides: Partial<GoalHarnessResult> = {}): GoalHarnessResult {
  return {
    goal: makeGoal(),
    elaborationApplied: true,
    planGenerated: true,
    workItemCount: 1,
    escalations: [],
    delegatedToScheduler: true,
    ...overrides,
  };
}

function createMockRepository(): jest.Mocked<Pick<IWorkOrderRepository, 'listGoals' | 'initialize' | 'close'>> {
  return {
    listGoals: jest.fn().mockReturnValue([]),
    initialize: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  };
}

function createMockGoalHarness(): jest.Mocked<IGoalHarness> {
  return {
    submitGoal: jest.fn().mockResolvedValue(makeHarnessResult()),
    processQueuedGoal: jest.fn().mockResolvedValue(makeHarnessResult()),
    approvePlan: jest.fn().mockResolvedValue(undefined),
    cancelGoal: jest.fn().mockResolvedValue(undefined),
  };
}

function startDaemonNonBlocking(daemon: HarnessDaemon): void {
  // start() blocks in mainLoop, so fire-and-forget to avoid test hangs
  void daemon.start().catch(() => {});
}

describe('HarnessDaemon', () => {
  let repository: ReturnType<typeof createMockRepository>;
  let goalHarness: ReturnType<typeof createMockGoalHarness>;
  let daemon: HarnessDaemon | null;

  beforeEach(() => {
    repository = createMockRepository();
    goalHarness = createMockGoalHarness();
    daemon = null;
  });

  afterEach(() => {
    daemon?.stop();
  });

  it('initializes repository on start', async () => {
    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 100, maxConcurrentGoals: 2 }
    );

    startDaemonNonBlocking(daemon);
    await new Promise((r) => setTimeout(r, 30));

    expect(repository.initialize).toHaveBeenCalledTimes(1);
  });

  it('processes queued goals via GoalHarness.processQueuedGoal', async () => {
    const queuedGoal = makeGoal({ id: 'queued-1' });
    repository.listGoals
      .mockReturnValueOnce([queuedGoal])
      .mockReturnValue([]);

    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 50, maxConcurrentGoals: 5 }
    );

    startDaemonNonBlocking(daemon);
    await new Promise((r) => setTimeout(r, 80));

    expect(goalHarness.processQueuedGoal).toHaveBeenCalledWith('queued-1');
  });

  it('respects maxConcurrentGoals limit', async () => {
    const goals = [
      makeGoal({ id: 'g1' }),
      makeGoal({ id: 'g2' }),
      makeGoal({ id: 'g3' }),
    ];

    repository.listGoals.mockReturnValue(goals);

    // Make processQueuedGoal slow so goals stay "active"
    goalHarness.processQueuedGoal.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(makeHarnessResult()), 500))
    );

    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 50, maxConcurrentGoals: 2 }
    );

    startDaemonNonBlocking(daemon);
    await new Promise((r) => setTimeout(r, 80));

    // Should only process maxConcurrentGoals (2) goals, not all 3
    expect(goalHarness.processQueuedGoal).toHaveBeenCalledTimes(2);
    expect(goalHarness.processQueuedGoal).toHaveBeenCalledWith('g1');
    expect(goalHarness.processQueuedGoal).toHaveBeenCalledWith('g2');
  });

  it('does not process goals when none are queued', async () => {
    repository.listGoals.mockReturnValue([]);

    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 50, maxConcurrentGoals: 5 }
    );

    startDaemonNonBlocking(daemon);
    await new Promise((r) => setTimeout(r, 80));

    expect(goalHarness.processQueuedGoal).not.toHaveBeenCalled();
  });

  it('handles processQueuedGoal errors gracefully without crashing', async () => {
    const queuedGoal = makeGoal({ id: 'failing-goal' });
    repository.listGoals
      .mockReturnValueOnce([queuedGoal])
      .mockReturnValue([]);

    goalHarness.processQueuedGoal.mockRejectedValueOnce(new Error('Elaboration failed'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 50, maxConcurrentGoals: 5 }
    );

    startDaemonNonBlocking(daemon);
    await new Promise((r) => setTimeout(r, 120));

    // Daemon should still be running despite the error
    expect(daemon.isActive()).toBe(true);

    consoleSpy.mockRestore();
  });

  it('reports isActive correctly', () => {
    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 100, maxConcurrentGoals: 2 }
    );

    expect(daemon.isActive()).toBe(false);
  });

  it('throws when started twice', async () => {
    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 100, maxConcurrentGoals: 2 }
    );

    startDaemonNonBlocking(daemon);
    await new Promise((r) => setTimeout(r, 30));

    await expect(daemon.start()).rejects.toThrow('HarnessDaemon is already running');
  });

  it('stop is idempotent when never started', () => {
    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 100, maxConcurrentGoals: 2 }
    );

    // Should not throw
    daemon.stop();
    daemon.stop();
  });

  it('closes repository on stop', async () => {
    daemon = new HarnessDaemon(
      repository as unknown as IWorkOrderRepository,
      goalHarness,
      { pollingIntervalMs: 100, maxConcurrentGoals: 2 }
    );

    startDaemonNonBlocking(daemon);
    await new Promise((r) => setTimeout(r, 30));
    daemon.stop();
    daemon = null; // prevent afterEach double-stop

    expect(repository.close).toHaveBeenCalledTimes(1);
  });

  describe('PostGoalEvaluator lifecycle', () => {
    function createMockPostGoalEvaluator(): jest.Mocked<Pick<PostGoalEvaluator, 'start' | 'stop' | 'createBlockedGoalContextPack'>> {
      return {
        start: jest.fn(),
        stop: jest.fn(),
        createBlockedGoalContextPack: jest.fn(),
      };
    }

    it('calls PostGoalEvaluator.start() during daemon start', async () => {
      const evaluator = createMockPostGoalEvaluator();

      daemon = new HarnessDaemon(
        repository as unknown as IWorkOrderRepository,
        goalHarness,
        { pollingIntervalMs: 100, maxConcurrentGoals: 2 },
        evaluator as unknown as PostGoalEvaluator,
      );

      startDaemonNonBlocking(daemon);
      await new Promise((r) => setTimeout(r, 30));

      expect(evaluator.start).toHaveBeenCalledTimes(1);
    });

    it('calls PostGoalEvaluator.stop() during daemon stop', async () => {
      const evaluator = createMockPostGoalEvaluator();

      daemon = new HarnessDaemon(
        repository as unknown as IWorkOrderRepository,
        goalHarness,
        { pollingIntervalMs: 100, maxConcurrentGoals: 2 },
        evaluator as unknown as PostGoalEvaluator,
      );

      startDaemonNonBlocking(daemon);
      await new Promise((r) => setTimeout(r, 30));
      daemon.stop();
      daemon = null;

      expect(evaluator.stop).toHaveBeenCalledTimes(1);
    });

    it('works without PostGoalEvaluator (optional dependency)', async () => {
      daemon = new HarnessDaemon(
        repository as unknown as IWorkOrderRepository,
        goalHarness,
        { pollingIntervalMs: 100, maxConcurrentGoals: 2 },
        // no evaluator passed
      );

      startDaemonNonBlocking(daemon);
      await new Promise((r) => setTimeout(r, 30));
      daemon.stop();
      daemon = null;

      // Should not throw — evaluator is optional
      expect(repository.close).toHaveBeenCalledTimes(1);
    });

    it('calls createBlockedGoalContextPack when a goal is blocked (not delegated, has escalations)', async () => {
      const evaluator = createMockPostGoalEvaluator();
      const blockedGoal = makeGoal({ id: 'blocked-1' });

      repository.listGoals
        .mockReturnValueOnce([blockedGoal])
        .mockReturnValue([]);

      goalHarness.processQueuedGoal.mockResolvedValueOnce(
        makeHarnessResult({
          goal: blockedGoal,
          delegatedToScheduler: false,
          escalations: ['Elaboration failed: missing context'],
        }),
      );

      daemon = new HarnessDaemon(
        repository as unknown as IWorkOrderRepository,
        goalHarness,
        { pollingIntervalMs: 50, maxConcurrentGoals: 5 },
        evaluator as unknown as PostGoalEvaluator,
      );

      startDaemonNonBlocking(daemon);
      await new Promise((r) => setTimeout(r, 80));

      expect(evaluator.createBlockedGoalContextPack).toHaveBeenCalledWith('blocked-1');
    });

    it('does NOT call createBlockedGoalContextPack when goal is delegated successfully', async () => {
      const evaluator = createMockPostGoalEvaluator();
      const successGoal = makeGoal({ id: 'success-1' });

      repository.listGoals
        .mockReturnValueOnce([successGoal])
        .mockReturnValue([]);

      goalHarness.processQueuedGoal.mockResolvedValueOnce(
        makeHarnessResult({
          goal: successGoal,
          delegatedToScheduler: true,
          escalations: [],
        }),
      );

      daemon = new HarnessDaemon(
        repository as unknown as IWorkOrderRepository,
        goalHarness,
        { pollingIntervalMs: 50, maxConcurrentGoals: 5 },
        evaluator as unknown as PostGoalEvaluator,
      );

      startDaemonNonBlocking(daemon);
      await new Promise((r) => setTimeout(r, 80));

      expect(evaluator.createBlockedGoalContextPack).not.toHaveBeenCalled();
    });

    it('does NOT call createBlockedGoalContextPack when goal has no escalations', async () => {
      const evaluator = createMockPostGoalEvaluator();
      const noEscGoal = makeGoal({ id: 'no-esc-1' });

      repository.listGoals
        .mockReturnValueOnce([noEscGoal])
        .mockReturnValue([]);

      goalHarness.processQueuedGoal.mockResolvedValueOnce(
        makeHarnessResult({
          goal: noEscGoal,
          delegatedToScheduler: false,
          escalations: [],
        }),
      );

      daemon = new HarnessDaemon(
        repository as unknown as IWorkOrderRepository,
        goalHarness,
        { pollingIntervalMs: 50, maxConcurrentGoals: 5 },
        evaluator as unknown as PostGoalEvaluator,
      );

      startDaemonNonBlocking(daemon);
      await new Promise((r) => setTimeout(r, 80));

      expect(evaluator.createBlockedGoalContextPack).not.toHaveBeenCalled();
    });
  });
});
