import { GatewayDaemonAttachment } from '../../../src/gateway/integration/gateway-daemon-attachment.js';
import { DaemonEventEmitterMixin } from '../../../src/autonomy/daemon-event-emitter.js';
import type { DaemonEventForwardingBinding } from '../../../src/gateway/integration/daemon-event-forwarding.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';
import type {
  Goal,
  Run,
  Escalation,
} from '../../../src/work-order/types/index.js';

class TestDaemonEmitter extends DaemonEventEmitterMixin {
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

function createGoal(id: string): Goal {
  return {
    id,
    created_at: 1,
    updated_at: 2,
    title: `Goal ${id}`,
    description: 'Goal description',
    success_criteria: [],
    status: 'queued',
    priority: 3,
    spent_tokens: 12,
    spent_time_minutes: 4,
    spent_cost_usd: 1.5,
  };
}

describe('GatewayDaemonAttachment', () => {
  let attachment: GatewayDaemonAttachment;
  let mockEventBus: EventBus;
  let daemon: TestDaemonEmitter;

  beforeEach(() => {
    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;

    attachment = new GatewayDaemonAttachment(mockEventBus);
    daemon = new TestDaemonEmitter();
  });

  it('subscribes to daemon-owned events and forwards them to the gateway bus', () => {
    attachment.connect(daemon);

    const goal: Goal = {
      ...createGoal('goal-1'),
      title: 'Goal title',
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

    attachment.connect(daemon);
    attachment.connect(daemon);

    expect(warnSpy).toHaveBeenCalledWith('[GatewayDaemonAttachment] Already connected to a daemon');
    warnSpy.mockRestore();
  });

  it('exposes connection state and direct event emission for gateway-owned callers', () => {
    expect(attachment.isConnected()).toBe(false);
    expect(attachment.getStatus()).toEqual({
      phase: 'detached',
      connected: false,
      connectedAt: null,
    });
    expect(attachment.getDetachStatus()).toEqual({
      phase: 'idle',
      attached: false,
      detachSupported: false,
      unsubscribeSupported: false,
    });

    attachment.connect(daemon);
    attachment.emit('test.event', { ok: true });

    expect(attachment.isConnected()).toBe(true);
    expect(attachment.getStatus()).toEqual({
      phase: 'attached',
      connected: true,
      connectedAt: expect.any(Number),
    });
    expect(attachment.getDetachStatus()).toEqual({
      phase: 'attached-awaiting-daemon-unsubscribe',
      attached: true,
      detachSupported: false,
      unsubscribeSupported: false,
    });
    expect(attachment.getOperationState()).toEqual({
      attachment: {
        daemon,
        status: {
          phase: 'attached',
          connected: true,
          connectedAt: expect.any(Number),
        },
      },
      detach: {
        phase: 'attached-awaiting-daemon-unsubscribe',
        attached: true,
        detachSupported: false,
        unsubscribeSupported: false,
      },
    });
    expect(mockEventBus.emit).toHaveBeenLastCalledWith('test.event', { ok: true });
  });

  it('retains the grouped forwarding binding as attachment-owned internal state', () => {
    attachment.connect(daemon);

    const internalState = attachment as unknown as {
      forwardingBinding: DaemonEventForwardingBinding | null;
    };

    expect(internalState.forwardingBinding).not.toBeNull();
    expect(typeof internalState.forwardingBinding?.release).toBe('function');
    expect(attachment.getDetachStatus()).toEqual({
      phase: 'attached-awaiting-daemon-unsubscribe',
      attached: true,
      detachSupported: false,
      unsubscribeSupported: false,
    });
  });

  it('detaches by releasing grouped forwarding and resetting lifecycle state', () => {
    attachment.connect(daemon);

    const goalBeforeDetach = createGoal('goal-before-detach');
    daemon.emitGoalCreated(goalBeforeDetach);

    attachment.detach();

    const goalAfterDetach = createGoal('goal-after-detach');
    daemon.emitGoalCreated(goalAfterDetach);

    const internalState = attachment as unknown as {
      forwardingBinding: DaemonEventForwardingBinding | null;
    };

    expect(mockEventBus.emit).toHaveBeenCalledTimes(1);
    expect(mockEventBus.emit).toHaveBeenCalledWith('goal.created', {
      goalId: 'goal-before-detach',
      title: 'Goal goal-before-detach',
      status: 'queued',
      priority: 3,
    });
    expect(internalState.forwardingBinding).toBeNull();
    expect(attachment.isConnected()).toBe(false);
    expect(attachment.getStatus()).toEqual({
      phase: 'detached',
      connected: false,
      connectedAt: null,
    });
    expect(attachment.getDetachStatus()).toEqual({
      phase: 'idle',
      attached: false,
      detachSupported: false,
      unsubscribeSupported: false,
    });
    expect(attachment.getOperationState()).toEqual({
      attachment: {
        daemon: null,
        status: {
          phase: 'detached',
          connected: false,
          connectedAt: null,
        },
      },
      detach: {
        phase: 'idle',
        attached: false,
        detachSupported: false,
        unsubscribeSupported: false,
      },
    });
  });

  it('treats repeated detach as an idempotent no-op', () => {
    attachment.connect(daemon);
    attachment.detach();

    expect(() => attachment.detach()).not.toThrow();
    expect(attachment.getStatus()).toEqual({
      phase: 'detached',
      connected: false,
      connectedAt: null,
    });
    expect(attachment.getDetachStatus()).toEqual({
      phase: 'idle',
      attached: false,
      detachSupported: false,
      unsubscribeSupported: false,
    });
  });

  it('can attach again after internal detach on the existing connect path', () => {
    attachment.connect(daemon);
    attachment.detach();

    const reattachedDaemon = new TestDaemonEmitter();

    attachment.connect(reattachedDaemon);
    reattachedDaemon.emitGoalCreated(createGoal('goal-after-reattach'));

    expect(attachment.getStatus()).toEqual({
      phase: 'attached',
      connected: true,
      connectedAt: expect.any(Number),
    });
    expect(attachment.getDetachStatus()).toEqual({
      phase: 'attached-awaiting-daemon-unsubscribe',
      attached: true,
      detachSupported: false,
      unsubscribeSupported: false,
    });
    expect(mockEventBus.emit).toHaveBeenCalledWith('goal.created', {
      goalId: 'goal-after-reattach',
      title: 'Goal goal-after-reattach',
      status: 'queued',
      priority: 3,
    });
  });
});
