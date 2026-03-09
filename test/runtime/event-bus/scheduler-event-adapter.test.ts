import { SchedulerEventAdapter } from '../../../src/runtime/event-bus/adapters/scheduler-event-adapter.js';
import type { EventBus as RuntimeEventBus } from '../../../src/runtime/event-bus/event-bus.js';
import type { ISchedulerCore } from '../../../src/scheduler/core/index.js';
import type { SchedulerEvent, SchedulerEventHandler } from '../../../src/scheduler/types.js';

describe('SchedulerEventAdapter', () => {
  let runtimeBus: jest.Mocked<RuntimeEventBus>;
  let scheduler: ISchedulerCore;
  let capturedHandler: SchedulerEventHandler | null;
  let adapter: SchedulerEventAdapter;

  beforeEach(() => {
    runtimeBus = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
      subscribeAll: jest.fn(),
    };
    capturedHandler = null;
    scheduler = {
      on: jest.fn((handler: SchedulerEventHandler) => {
        capturedHandler = handler;
      }),
      off: jest.fn((handler: SchedulerEventHandler) => {
        if (capturedHandler === handler) {
          capturedHandler = null;
        }
      }),
      getState: jest.fn(),
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      submitGoal: jest.fn(),
      cancelGoal: jest.fn(),
      getGoalState: jest.fn(),
      getAllGoalStates: jest.fn(),
      getMetrics: jest.fn(),
      tick: jest.fn(),
      applyRuntimeRollout: jest.fn(),
    } as unknown as ISchedulerCore;
    adapter = new SchedulerEventAdapter(runtimeBus);
  });

  it('republishes selected scheduler events into the runtime event bus', () => {
    adapter.connect(scheduler);

    const event: SchedulerEvent = {
      type: 'verification_completed',
      timestamp: 1_700_000_000_000,
      goalId: 'goal-123',
      workItemId: 'workitem-123',
      runId: 'run-123',
      data: {
        passed: true,
        summary: 'All checks passed',
      },
    };

    capturedHandler?.(event);

    expect(runtimeBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      type: 'verification.completed',
      source: 'scheduler',
      timestamp: 1_700_000_000_000,
      goalId: 'goal-123',
      taskId: 'workitem-123',
      runId: 'run-123',
      payload: event,
    }));
  });

  it('ignores scheduler events outside the mirrored set', () => {
    adapter.connect(scheduler);

    capturedHandler?.({
      type: 'goal_started',
      timestamp: 1_700_000_000_000,
      goalId: 'goal-123',
    });

    expect(runtimeBus.publish).not.toHaveBeenCalled();
  });

  it('stops forwarding scheduler events after disconnect', () => {
    adapter.connect(scheduler);

    adapter.disconnect();
    capturedHandler?.({
      type: 'run_completed',
      timestamp: 1_700_000_000_000,
      goalId: 'goal-123',
      workItemId: 'workitem-123',
      runId: 'run-123',
    });

    expect(runtimeBus.publish).not.toHaveBeenCalled();
    expect(scheduler.off).toHaveBeenCalledTimes(1);
  });
});
