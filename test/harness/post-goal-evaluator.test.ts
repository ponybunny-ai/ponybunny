/**
 * PostGoalEvaluator Unit Tests — ADR-001 Phase 5
 *
 * Tests PostGoalEvaluator in isolation with fully mocked dependencies.
 * Verifies lifecycle, event filtering, evaluation aggregation, replan logging,
 * and bounded report storage.
 */

import { PostGoalEvaluator } from '../../src/harness/post-goal-evaluator.js';
import type { PostGoalEvaluatorDependencies } from '../../src/harness/post-goal-evaluator.js';
import type { ISchedulerCore } from '../../src/scheduler/core/types.js';
import type { IEvaluationService, EvaluationResult } from '../../src/app/lifecycle/stage-interfaces.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { SchedulerEvent, SchedulerEventHandler } from '../../src/scheduler/types.js';
import type { WorkItem, Run } from '../../src/work-order/types/index.js';

// --- Helpers ---

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'A test work item',
    item_type: 'code',
    status: 'done',
    priority: 1,
    effort_estimate: 'S',
    retry_count: 0,
    max_retries: 3,
    dependencies: [],
    verification_plan: [],
    ...overrides,
  } as WorkItem;
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    created_at: Date.now(),
    work_item_id: 'wi-1',
    goal_id: 'goal-1',
    agent_type: 'code',
    run_sequence: 1,
    status: 'success',
    tokens_used: 100,
    cost_usd: 0.01,
    artifacts: [],
    ...overrides,
  } as Run;
}

function makeEvent(overrides: Partial<SchedulerEvent> = {}): SchedulerEvent {
  return {
    type: 'goal_completed',
    timestamp: Date.now(),
    goalId: 'goal-1',
    ...overrides,
  };
}

function createMockDeps(): {
  deps: PostGoalEvaluatorDependencies;
  handlers: SchedulerEventHandler[];
  evaluationService: jest.Mocked<IEvaluationService>;
  repository: jest.Mocked<Pick<IWorkOrderRepository, 'getWorkItemsByGoal' | 'getRunsByWorkItem'>>;
} {
  const handlers: SchedulerEventHandler[] = [];

  const schedulerCore = {
    on: jest.fn((handler: SchedulerEventHandler) => { handlers.push(handler); }),
    off: jest.fn((handler: SchedulerEventHandler) => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }),
  } as unknown as ISchedulerCore;

  const evaluationService: jest.Mocked<IEvaluationService> = {
    evaluateRun: jest.fn(),
  };

  const repository = {
    getWorkItemsByGoal: jest.fn().mockReturnValue([]),
    getRunsByWorkItem: jest.fn().mockReturnValue([]),
  } as unknown as jest.Mocked<Pick<IWorkOrderRepository, 'getWorkItemsByGoal' | 'getRunsByWorkItem'>>;

  return {
    deps: {
      schedulerCore,
      evaluationService,
      repository: repository as unknown as IWorkOrderRepository,
    },
    handlers,
    evaluationService,
    repository: repository as any,
  };
}

// --- Tests ---

describe('PostGoalEvaluator', () => {
  // ---- Lifecycle ----

  describe('lifecycle', () => {
    it('start() subscribes handler via schedulerCore.on()', () => {
      const { deps, handlers } = createMockDeps();
      const evaluator = new PostGoalEvaluator(deps);

      expect(handlers).toHaveLength(0);
      evaluator.start();
      expect(handlers).toHaveLength(1);
    });

    it('start() throws if already started', () => {
      const { deps } = createMockDeps();
      const evaluator = new PostGoalEvaluator(deps);

      evaluator.start();
      expect(() => evaluator.start()).toThrow('already started');
    });

    it('stop() unsubscribes handler via schedulerCore.off()', () => {
      const { deps, handlers } = createMockDeps();
      const evaluator = new PostGoalEvaluator(deps);

      evaluator.start();
      expect(handlers).toHaveLength(1);
      evaluator.stop();
      expect(handlers).toHaveLength(0);
    });

    it('stop() before start() is safe (no-op)', () => {
      const { deps } = createMockDeps();
      const evaluator = new PostGoalEvaluator(deps);

      expect(() => evaluator.stop()).not.toThrow();
    });

    it('can restart after stop()', () => {
      const { deps, handlers } = createMockDeps();
      const evaluator = new PostGoalEvaluator(deps);

      evaluator.start();
      evaluator.stop();
      expect(handlers).toHaveLength(0);

      evaluator.start();
      expect(handlers).toHaveLength(1);
    });
  });

  // ---- Event filtering ----

  describe('event filtering', () => {
    it('ignores non-goal events', async () => {
      const { deps, handlers, evaluationService } = createMockDeps();
      const evaluator = new PostGoalEvaluator(deps);
      evaluator.start();

      const nonGoalEvents: SchedulerEvent['type'][] = [
        'work_item_started',
        'work_item_completed',
        'run_started',
        'run_completed',
        'verification_started',
        'verification_completed',
        'escalation_created',
        'budget_warning',
      ];

      for (const type of nonGoalEvents) {
        await handlers[0](makeEvent({ type }));
      }

      expect(evaluationService.evaluateRun).not.toHaveBeenCalled();
    });

    it('handles goal_completed events', async () => {
      const { deps, handlers, repository, evaluationService } = createMockDeps();
      const wi = makeWorkItem();
      const run = makeRun();
      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([run]);
      evaluationService.evaluateRun.mockResolvedValue({
        decision: 'publish',
        reasoning: 'ok',
        nextActions: [],
      });

      const evaluator = new PostGoalEvaluator(deps);
      evaluator.start();

      await handlers[0](makeEvent({ type: 'goal_completed', goalId: 'goal-1' }));
      // Wait for async evaluation
      await new Promise(r => setTimeout(r, 10));

      expect(evaluationService.evaluateRun).toHaveBeenCalledTimes(1);
      const reports = evaluator.getReports();
      expect(reports).toHaveLength(1);
      expect(reports[0].trigger).toBe('goal_completed');
    });

    it('handles goal_failed events', async () => {
      const { deps, handlers, repository, evaluationService } = createMockDeps();
      const wi = makeWorkItem();
      const run = makeRun({ status: 'failure' });
      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([run]);
      evaluationService.evaluateRun.mockResolvedValue({
        decision: 'escalate',
        reasoning: 'failed',
        nextActions: [],
      });

      const evaluator = new PostGoalEvaluator(deps);
      evaluator.start();

      await handlers[0](makeEvent({ type: 'goal_failed', goalId: 'goal-1' }));
      await new Promise(r => setTimeout(r, 10));

      const reports = evaluator.getReports();
      expect(reports).toHaveLength(1);
      expect(reports[0].trigger).toBe('goal_failed');
      expect(reports[0].summary.escalate).toBe(1);
    });

    it('ignores events without goalId', async () => {
      const { deps, handlers, evaluationService } = createMockDeps();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const evaluator = new PostGoalEvaluator(deps);
      evaluator.start();

      await handlers[0](makeEvent({ type: 'goal_completed', goalId: undefined }));
      await new Promise(r => setTimeout(r, 10));

      expect(evaluationService.evaluateRun).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('without goalId'));
      warnSpy.mockRestore();
    });
  });

  // ---- Evaluation logic ----

  describe('evaluation', () => {
    it('evaluates multiple work items independently', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const wi1 = makeWorkItem({ id: 'wi-1' });
      const wi2 = makeWorkItem({ id: 'wi-2' });
      const run1 = makeRun({ id: 'run-1', work_item_id: 'wi-1', run_sequence: 1 });
      const run2 = makeRun({ id: 'run-2', work_item_id: 'wi-2', run_sequence: 1 });

      repository.getWorkItemsByGoal.mockReturnValue([wi1, wi2]);
      repository.getRunsByWorkItem.mockImplementation((id: string) => {
        if (id === 'wi-1') return [run1];
        if (id === 'wi-2') return [run2];
        return [];
      });
      evaluationService.evaluateRun.mockResolvedValue({
        decision: 'publish',
        reasoning: 'ok',
        nextActions: [],
      });

      const evaluator = new PostGoalEvaluator(deps);
      const report = await evaluator.evaluateGoal('goal-1', 'goal_completed');

      expect(evaluationService.evaluateRun).toHaveBeenCalledTimes(2);
      expect(report.workItemResults).toHaveLength(2);
      expect(report.summary.total).toBe(2);
      expect(report.summary.publish).toBe(2);
    });

    it('picks latest run by run_sequence', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const wi = makeWorkItem();
      const run1 = makeRun({ id: 'run-1', run_sequence: 1 });
      const run2 = makeRun({ id: 'run-2', run_sequence: 3 });
      const run3 = makeRun({ id: 'run-3', run_sequence: 2 });

      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([run1, run2, run3]);
      evaluationService.evaluateRun.mockResolvedValue({
        decision: 'publish',
        reasoning: 'ok',
        nextActions: [],
      });

      const evaluator = new PostGoalEvaluator(deps);
      const report = await evaluator.evaluateGoal('goal-1', 'goal_completed');

      expect(report.workItemResults[0].runId).toBe('run-2');
      expect(evaluationService.evaluateRun).toHaveBeenCalledWith(
        wi,
        expect.objectContaining({ id: 'run-2' }),
        expect.anything(),
      );
    });

    it('skips work items with no runs', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const wi = makeWorkItem();

      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([]);

      const evaluator = new PostGoalEvaluator(deps);
      const report = await evaluator.evaluateGoal('goal-1', 'goal_completed');

      expect(evaluationService.evaluateRun).not.toHaveBeenCalled();
      expect(report.workItemResults[0].skipped).toBe(true);
      expect(report.workItemResults[0].runId).toBeNull();
      expect(report.summary.skipped).toBe(1);
    });

    it('constructs correct synthetic verification for goal_completed', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const wi = makeWorkItem();
      const run = makeRun();
      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([run]);
      evaluationService.evaluateRun.mockResolvedValue({
        decision: 'publish',
        reasoning: 'ok',
        nextActions: [],
      });

      const evaluator = new PostGoalEvaluator(deps);
      await evaluator.evaluateGoal('goal-1', 'goal_completed');

      expect(evaluationService.evaluateRun).toHaveBeenCalledWith(
        wi,
        run,
        { passed: true, gateResults: [] },
      );
    });

    it('constructs correct synthetic verification for goal_failed', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const wi = makeWorkItem();
      const run = makeRun({ status: 'failure' });
      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([run]);
      evaluationService.evaluateRun.mockResolvedValue({
        decision: 'escalate',
        reasoning: 'failed',
        nextActions: [],
      });

      const evaluator = new PostGoalEvaluator(deps);
      await evaluator.evaluateGoal('goal-1', 'goal_failed');

      expect(evaluationService.evaluateRun).toHaveBeenCalledWith(
        wi,
        run,
        { passed: false, gateResults: [], failureReason: 'Goal failed' },
      );
    });

    it('handles evaluation errors gracefully (counts as skipped)', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const wi = makeWorkItem();
      const run = makeRun();
      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([run]);
      evaluationService.evaluateRun.mockRejectedValue(new Error('LLM timeout'));

      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      const evaluator = new PostGoalEvaluator(deps);
      const report = await evaluator.evaluateGoal('goal-1', 'goal_completed');

      expect(report.workItemResults[0].skipped).toBe(true);
      expect(report.workItemResults[0].evaluation).toBeNull();
      expect(report.summary.skipped).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to evaluate work item'),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });
  });

  // ---- Replan handling ----

  describe('replan decisions', () => {
    it('logs replan as unactionable', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const wi = makeWorkItem({ id: 'wi-replan' });
      const run = makeRun();
      repository.getWorkItemsByGoal.mockReturnValue([wi]);
      repository.getRunsByWorkItem.mockReturnValue([run]);
      evaluationService.evaluateRun.mockResolvedValue({
        decision: 'replan',
        reasoning: 'needs different approach',
        nextActions: ['replan'],
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const evaluator = new PostGoalEvaluator(deps);
      const report = await evaluator.evaluateGoal('goal-1', 'goal_completed');

      expect(report.summary.replan).toBe(1);
      expect(report.unactionableDecisions).toHaveLength(1);
      expect(report.unactionableDecisions[0]).toContain('wi-replan');
      expect(report.unactionableDecisions[0]).toContain('replan requested but not implemented');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('replan decision is unactionable'),
      );
      warnSpy.mockRestore();
    });
  });

  // ---- Report management ----

  describe('reports', () => {
    it('getReports() returns accumulated reports', async () => {
      const { deps, repository } = createMockDeps();
      repository.getWorkItemsByGoal.mockReturnValue([]);

      const evaluator = new PostGoalEvaluator(deps);

      await evaluator.evaluateGoal('goal-1', 'goal_completed');
      await evaluator.evaluateGoal('goal-2', 'goal_failed');

      const reports = evaluator.getReports();
      expect(reports).toHaveLength(2);
      expect(reports[0].goalId).toBe('goal-1');
      expect(reports[1].goalId).toBe('goal-2');
    });

    it('getReports() returns a copy (not the internal array)', async () => {
      const { deps, repository } = createMockDeps();
      repository.getWorkItemsByGoal.mockReturnValue([]);

      const evaluator = new PostGoalEvaluator(deps);
      await evaluator.evaluateGoal('goal-1', 'goal_completed');

      const reports = evaluator.getReports();
      reports.push({} as any);

      expect(evaluator.getReports()).toHaveLength(1);
    });

    it('bounds reports to 100 (FIFO eviction)', async () => {
      const { deps, repository } = createMockDeps();
      repository.getWorkItemsByGoal.mockReturnValue([]);

      const evaluator = new PostGoalEvaluator(deps);

      for (let i = 0; i < 105; i++) {
        await evaluator.evaluateGoal(`goal-${i}`, 'goal_completed');
      }

      const reports = evaluator.getReports();
      expect(reports).toHaveLength(100);
      // First 5 evicted, oldest remaining is goal-5
      expect(reports[0].goalId).toBe('goal-5');
      expect(reports[99].goalId).toBe('goal-104');
    });
  });

  // ---- Decision summary tallying ----

  describe('summary tallying', () => {
    it('correctly tallies mixed decisions', async () => {
      const { deps, evaluationService, repository } = createMockDeps();
      const items = [
        makeWorkItem({ id: 'wi-1' }),
        makeWorkItem({ id: 'wi-2' }),
        makeWorkItem({ id: 'wi-3' }),
        makeWorkItem({ id: 'wi-4' }),
      ];
      repository.getWorkItemsByGoal.mockReturnValue(items);
      repository.getRunsByWorkItem.mockReturnValue([makeRun()]);

      const decisions: EvaluationResult['decision'][] = ['publish', 'retry', 'escalate', 'replan'];
      let callCount = 0;
      evaluationService.evaluateRun.mockImplementation(async () => ({
        decision: decisions[callCount++],
        reasoning: 'test',
        nextActions: [],
      }));

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const evaluator = new PostGoalEvaluator(deps);
      const report = await evaluator.evaluateGoal('goal-1', 'goal_completed');

      expect(report.summary).toEqual({
        total: 4,
        publish: 1,
        retry: 1,
        replan: 1,
        escalate: 1,
        skipped: 0,
      });

      warnSpy.mockRestore();
    });
  });

  // ---- Error containment ----

  describe('error containment', () => {
    it('event handler errors do not propagate', async () => {
      const { deps, handlers, repository } = createMockDeps();
      repository.getWorkItemsByGoal.mockImplementation(() => {
        throw new Error('repository crash');
      });

      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      const evaluator = new PostGoalEvaluator(deps);
      evaluator.start();

      // Should not throw
      await handlers[0](makeEvent({ type: 'goal_completed', goalId: 'goal-1' }));
      await new Promise(r => setTimeout(r, 10));

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('evaluation failed for goal'),
        expect.any(Error),
      );
      errorSpy.mockRestore();
    });

    it('does not evaluate after stop()', async () => {
      const { deps, handlers, evaluationService, repository } = createMockDeps();
      repository.getWorkItemsByGoal.mockReturnValue([makeWorkItem()]);
      repository.getRunsByWorkItem.mockReturnValue([makeRun()]);

      const evaluator = new PostGoalEvaluator(deps);
      evaluator.start();
      evaluator.stop();

      // Handler was removed, so no handlers to call
      expect(handlers).toHaveLength(0);
      expect(evaluationService.evaluateRun).not.toHaveBeenCalled();
    });
  });
});
