/**
 * PostGoalEvaluator Integration Tests — ADR-001 Phase 5
 *
 * Tests the full evaluation flow: event emission → PostGoalEvaluator → EvaluationService → report.
 * Uses a mock scheduler with real event dispatch and real EvaluationService.
 */

import { PostGoalEvaluator } from '../../src/harness/post-goal-evaluator.js';
import { EvaluationService } from '../../src/app/lifecycle/evaluation/evaluation-service.js';
import type { ISchedulerCore } from '../../src/scheduler/core/types.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import type { SchedulerEventHandler, SchedulerEvent } from '../../src/scheduler/types.js';
import type { WorkItem, Run } from '../../src/work-order/types/index.js';

// --- Mock scheduler with real event dispatch ---

class MockSchedulerWithEvents {
  private handlers: SchedulerEventHandler[] = [];

  on(handler: SchedulerEventHandler): void {
    this.handlers.push(handler);
  }

  off(handler: SchedulerEventHandler): void {
    const idx = this.handlers.indexOf(handler);
    if (idx >= 0) this.handlers.splice(idx, 1);
  }

  async emit(event: SchedulerEvent): Promise<void> {
    for (const handler of this.handlers) {
      await handler(event);
    }
  }

  get handlerCount(): number {
    return this.handlers.length;
  }
}

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

describe('PostGoalEvaluator Integration', () => {
  let mockScheduler: MockSchedulerWithEvents;
  let mockRepository: jest.Mocked<Pick<IWorkOrderRepository, 'getWorkItemsByGoal' | 'getRunsByWorkItem' | 'getRepeatedErrorSignatures'>>;
  let evaluationService: EvaluationService;
  let evaluator: PostGoalEvaluator;

  beforeEach(() => {
    mockScheduler = new MockSchedulerWithEvents();
    mockRepository = {
      getWorkItemsByGoal: jest.fn().mockReturnValue([]),
      getRunsByWorkItem: jest.fn().mockReturnValue([]),
      getRepeatedErrorSignatures: jest.fn().mockReturnValue([]),
    } as any;

    // Real EvaluationService with mock repository
    evaluationService = new EvaluationService(mockRepository as unknown as IWorkOrderRepository);

    evaluator = new PostGoalEvaluator({
      schedulerCore: mockScheduler as unknown as ISchedulerCore,
      evaluationService,
      repository: mockRepository as unknown as IWorkOrderRepository,
    });
  });

  afterEach(() => {
    evaluator.stop();
  });

  it('goal_completed → evaluates successful work items as publish', async () => {
    const wi = makeWorkItem({ id: 'wi-success', retry_count: 0, max_retries: 3 });
    const run = makeRun({ id: 'run-ok', status: 'success', work_item_id: 'wi-success' });
    mockRepository.getWorkItemsByGoal.mockReturnValue([wi]);
    mockRepository.getRunsByWorkItem.mockReturnValue([run]);

    evaluator.start();
    await mockScheduler.emit({
      type: 'goal_completed',
      timestamp: Date.now(),
      goalId: 'goal-1',
    });

    // Wait for async evaluation
    await new Promise(r => setTimeout(r, 20));

    const reports = evaluator.getReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].trigger).toBe('goal_completed');
    expect(reports[0].summary.publish).toBe(1);
    expect(reports[0].workItemResults[0].evaluation?.decision).toBe('publish');
  });

  it('goal_failed → evaluates failed work items as escalate (retries exhausted)', async () => {
    const wi = makeWorkItem({ id: 'wi-fail', retry_count: 3, max_retries: 3 });
    const run = makeRun({ id: 'run-fail', status: 'failure', work_item_id: 'wi-fail', error_message: 'timeout' });
    mockRepository.getWorkItemsByGoal.mockReturnValue([wi]);
    mockRepository.getRunsByWorkItem.mockReturnValue([run]);

    evaluator.start();
    await mockScheduler.emit({
      type: 'goal_failed',
      timestamp: Date.now(),
      goalId: 'goal-1',
    });
    await new Promise(r => setTimeout(r, 20));

    const reports = evaluator.getReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].trigger).toBe('goal_failed');
    expect(reports[0].summary.escalate).toBe(1);
  });

  it('mixed work item outcomes produce correct aggregate', async () => {
    const wi1 = makeWorkItem({ id: 'wi-ok', retry_count: 0, max_retries: 3 });
    const wi2 = makeWorkItem({ id: 'wi-bad', retry_count: 3, max_retries: 3 });
    const wi3 = makeWorkItem({ id: 'wi-empty' }); // no runs

    const run1 = makeRun({ id: 'run-1', status: 'success', work_item_id: 'wi-ok' });
    const run2 = makeRun({ id: 'run-2', status: 'failure', work_item_id: 'wi-bad', error_message: 'crash' });

    mockRepository.getWorkItemsByGoal.mockReturnValue([wi1, wi2, wi3]);
    mockRepository.getRunsByWorkItem.mockImplementation((id: string) => {
      if (id === 'wi-ok') return [run1];
      if (id === 'wi-bad') return [run2];
      return [];
    });

    evaluator.start();
    await mockScheduler.emit({
      type: 'goal_completed',
      timestamp: Date.now(),
      goalId: 'goal-mixed',
    });
    await new Promise(r => setTimeout(r, 20));

    const reports = evaluator.getReports();
    expect(reports).toHaveLength(1);
    const r = reports[0];
    expect(r.goalId).toBe('goal-mixed');
    expect(r.summary.total).toBe(3);
    expect(r.summary.publish).toBe(1);
    expect(r.summary.escalate).toBe(1);
    expect(r.summary.skipped).toBe(1);
  });

  it('no evaluation after stop()', async () => {
    const wi = makeWorkItem();
    const run = makeRun();
    mockRepository.getWorkItemsByGoal.mockReturnValue([wi]);
    mockRepository.getRunsByWorkItem.mockReturnValue([run]);

    evaluator.start();
    evaluator.stop();

    expect(mockScheduler.handlerCount).toBe(0);

    // Emit directly — no handler subscribed
    await mockScheduler.emit({
      type: 'goal_completed',
      timestamp: Date.now(),
      goalId: 'goal-1',
    });
    await new Promise(r => setTimeout(r, 20));

    expect(evaluator.getReports()).toHaveLength(0);
  });

  it('goal with zero work items produces empty report', async () => {
    mockRepository.getWorkItemsByGoal.mockReturnValue([]);

    evaluator.start();
    await mockScheduler.emit({
      type: 'goal_completed',
      timestamp: Date.now(),
      goalId: 'goal-empty',
    });
    await new Promise(r => setTimeout(r, 20));

    const reports = evaluator.getReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].goalId).toBe('goal-empty');
    expect(reports[0].summary.total).toBe(0);
    expect(reports[0].workItemResults).toHaveLength(0);
  });

  it('goal_failed with retryable work item produces retry decision', async () => {
    // Work item still has retries left but goal itself failed
    const wi = makeWorkItem({ id: 'wi-retryable', retry_count: 0, max_retries: 3 });
    const run = makeRun({ id: 'run-err', status: 'failure', work_item_id: 'wi-retryable', error_message: 'transient' });
    mockRepository.getWorkItemsByGoal.mockReturnValue([wi]);
    mockRepository.getRunsByWorkItem.mockReturnValue([run]);

    evaluator.start();
    await mockScheduler.emit({
      type: 'goal_failed',
      timestamp: Date.now(),
      goalId: 'goal-retry',
    });
    await new Promise(r => setTimeout(r, 20));

    const reports = evaluator.getReports();
    expect(reports).toHaveLength(1);
    // EvaluationService returns retry when retries remain and no repeated error pattern
    expect(reports[0].summary.retry).toBe(1);
    expect(reports[0].workItemResults[0].evaluation?.decision).toBe('retry');
  });
});
