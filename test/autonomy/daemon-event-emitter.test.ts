import { DaemonEventEmitterMixin } from '../../src/autonomy/daemon-event-emitter.js';
import type { Goal, WorkItem } from '../../src/work-order/types/index.js';

class TestDaemonEmitter extends DaemonEventEmitterMixin {
  emitGoalUpdated(goal: Goal): void {
    super.emitGoalUpdated(goal);
  }

  emitWorkItemFailed(workItem: WorkItem, error: string): void {
    super.emitWorkItemFailed(workItem, error);
  }
}

describe('DaemonEventEmitterMixin', () => {
  it('stores callbacks on the daemon-owned side and emits them without gateway dependencies', () => {
    const emitter = new TestDaemonEmitter();
    const goalUpdated = jest.fn();
    const workItemFailed = jest.fn();

    emitter.onGoalUpdated(goalUpdated);
    emitter.onWorkItemFailed(workItemFailed);

    const goal: Goal = {
      id: 'goal-1',
      created_at: 1,
      updated_at: 2,
      title: 'Goal title',
      description: 'Goal description',
      success_criteria: [],
      status: 'active',
      priority: 2,
      spent_tokens: 3,
      spent_time_minutes: 4,
      spent_cost_usd: 5,
    };

    const workItem: WorkItem = {
      id: 'work-1',
      created_at: 1,
      updated_at: 2,
      goal_id: 'goal-1',
      title: 'Work item',
      description: 'Work description',
      item_type: 'analysis',
      status: 'failed',
      priority: 1,
      dependencies: [],
      blocks: [],
      estimated_effort: 'S',
      retry_count: 2,
      max_retries: 3,
      verification_status: 'failed',
    };

    emitter.emitGoalUpdated(goal);
    emitter.emitWorkItemFailed(workItem, 'boom');

    expect(goalUpdated).toHaveBeenCalledWith(goal);
    expect(workItemFailed).toHaveBeenCalledWith(workItem, 'boom');
  });

  it('returns idempotent release handles and preserves current emit-cycle ordering', () => {
    const emitter = new TestDaemonEmitter();
    const calls: string[] = [];

    const firstSubscription = emitter.onGoalUpdated((goal) => {
      calls.push(`first:${goal.id}`);
      firstSubscription.release();
    });
    const secondCallback = jest.fn((goal: Goal) => {
      calls.push(`second:${goal.id}`);
    });
    const secondSubscription = emitter.onGoalUpdated(secondCallback);

    const goal: Goal = {
      id: 'goal-2',
      created_at: 1,
      updated_at: 2,
      title: 'Goal title',
      description: 'Goal description',
      success_criteria: [],
      status: 'active',
      priority: 2,
      spent_tokens: 3,
      spent_time_minutes: 4,
      spent_cost_usd: 5,
    };

    emitter.emitGoalUpdated(goal);
    emitter.emitGoalUpdated(goal);
    firstSubscription.release();
    secondSubscription.release();
    secondSubscription.release();
    emitter.emitGoalUpdated(goal);

    expect(calls).toEqual([
      'first:goal-2',
      'second:goal-2',
      'second:goal-2',
    ]);
    expect(secondCallback).toHaveBeenCalledTimes(2);
  });
});
