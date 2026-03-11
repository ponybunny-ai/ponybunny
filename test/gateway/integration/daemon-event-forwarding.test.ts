import { DaemonEventEmitterMixin } from '../../../src/autonomy/daemon-event-emitter.js';
import { registerDaemonEventForwarders } from '../../../src/gateway/integration/daemon-event-forwarding.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';
import type { Goal, Run } from '../../../src/work-order/types/index.js';

class TestDaemonEmitter extends DaemonEventEmitterMixin {
  emitGoalCreated(goal: Goal): void {
    super.emitGoalCreated(goal);
  }

  emitRunCompleted(run: Run): void {
    super.emitRunCompleted(run);
  }
}

describe('registerDaemonEventForwarders', () => {
  it('returns one grouped binding that releases all installed gateway forwarders', () => {
    const eventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;
    const daemon = new TestDaemonEmitter();

    const binding = registerDaemonEventForwarders(eventBus, daemon);

    const goal: Goal = {
      id: 'goal-1',
      created_at: 1,
      updated_at: 2,
      title: 'Goal title',
      description: 'Goal description',
      success_criteria: [],
      status: 'queued',
      priority: 3,
      spent_tokens: 12,
      spent_time_minutes: 4,
      spent_cost_usd: 1.5,
    };
    const run: Run = {
      id: 'run-1',
      created_at: 1,
      work_item_id: 'work-1',
      goal_id: 'goal-1',
      agent_type: 'executor',
      run_sequence: 2,
      status: 'success',
      tokens_used: 99,
      time_seconds: 11,
      cost_usd: 2.25,
      artifacts: [],
    };

    daemon.emitGoalCreated(goal);
    daemon.emitRunCompleted(run);
    binding.release();
    binding.release();
    daemon.emitGoalCreated(goal);
    daemon.emitRunCompleted(run);

    expect(eventBus.emit).toHaveBeenCalledTimes(2);
    expect(eventBus.emit).toHaveBeenNthCalledWith(1, 'goal.created', {
      goalId: 'goal-1',
      title: 'Goal title',
      status: 'queued',
      priority: 3,
    });
    expect(eventBus.emit).toHaveBeenNthCalledWith(2, 'run.completed', {
      runId: 'run-1',
      workItemId: 'work-1',
      goalId: 'goal-1',
      status: 'success',
      tokens_used: 99,
      time_seconds: 11,
      cost_usd: 2.25,
    });
  });
});
