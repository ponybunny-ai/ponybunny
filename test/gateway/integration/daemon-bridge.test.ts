import {
  DaemonBridge,
  DaemonEventEmitterMixin as GatewayDaemonEventEmitterMixin,
} from '../../../src/gateway/integration/daemon-bridge.js';
import { DaemonEventEmitterMixin as AutonomyDaemonEventEmitterMixin } from '../../../src/autonomy/daemon-event-emitter.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';
import type {
  Goal,
  WorkItem,
  Run,
  Escalation,
} from '../../../src/work-order/types/index.js';

class TestDaemonEmitter extends AutonomyDaemonEventEmitterMixin {
  emitGoalCreated(goal: Goal): void {
    super.emitGoalCreated(goal);
  }

  emitRunCompleted(run: Run): void {
    super.emitRunCompleted(run);
  }

  emitEscalationResolved(escalation: Escalation): void {
    super.emitEscalationResolved(escalation);
  }
}

describe('DaemonBridge', () => {
  let bridge: DaemonBridge;
  let mockEventBus: EventBus;
  let daemon: TestDaemonEmitter;

  beforeEach(() => {
    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;

    bridge = new DaemonBridge(mockEventBus);
    daemon = new TestDaemonEmitter();
  });

  it('keeps the historical gateway mixin export as a compatibility alias', () => {
    expect(GatewayDaemonEventEmitterMixin).toBe(AutonomyDaemonEventEmitterMixin);
  });

  it('subscribes to daemon-owned events and forwards them to the gateway bus', () => {
    bridge.connect(daemon);

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

    const escalation: Escalation = {
      id: 'esc-1',
      created_at: 1,
      work_item_id: 'work-1',
      goal_id: 'goal-1',
      escalation_type: 'validation_failed',
      severity: 'high',
      status: 'resolved',
      title: 'Needs review',
      description: 'Manual review completed',
      resolution_action: 'retry',
      resolver: 'operator',
    };

    daemon.emitGoalCreated(goal);
    daemon.emitRunCompleted(run);
    daemon.emitEscalationResolved(escalation);

    expect(mockEventBus.emit).toHaveBeenNthCalledWith(1, 'goal.created', {
      goalId: 'goal-1',
      title: 'Goal title',
      status: 'queued',
      priority: 3,
    });
    expect(mockEventBus.emit).toHaveBeenNthCalledWith(2, 'run.completed', {
      runId: 'run-1',
      workItemId: 'work-1',
      goalId: 'goal-1',
      status: 'success',
      tokens_used: 99,
      time_seconds: 11,
      cost_usd: 2.25,
    });
    expect(mockEventBus.emit).toHaveBeenNthCalledWith(3, 'escalation.resolved', {
      escalationId: 'esc-1',
      workItemId: 'work-1',
      goalId: 'goal-1',
      resolution_action: 'retry',
      resolver: 'operator',
    });
  });

  it('warns and preserves the first subscription if already connected', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    bridge.connect(daemon);
    bridge.connect(daemon);

    expect(warnSpy).toHaveBeenCalledWith('[DaemonBridge] Already connected to a daemon');
    warnSpy.mockRestore();
  });
});
