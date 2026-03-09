import { DebugEventAdapter } from '../../../src/runtime/event-bus/adapters/debug-event-adapter.js';
import { debugEmitter } from '../../../src/debug/emitter.js';
import type { EventBus as RuntimeEventBus } from '../../../src/runtime/event-bus/event-bus.js';

describe('DebugEventAdapter', () => {
  let runtimeBus: jest.Mocked<RuntimeEventBus>;
  let adapter: DebugEventAdapter;

  beforeEach(() => {
    runtimeBus = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
    };
    adapter = new DebugEventAdapter(runtimeBus);
    debugEmitter.clearContext();
    debugEmitter.disable();
  });

  afterEach(() => {
    adapter.stop();
    debugEmitter.clearContext();
    debugEmitter.disable();
  });

  it('republishes debug events into the runtime event bus', () => {
    adapter.start();
    debugEmitter.enable();
    debugEmitter.setContext({
      goalId: 'goal-123',
      workItemId: 'workitem-123',
      runId: 'run-123',
    });

    debugEmitter.emitDebug('scheduler.run.started', 'scheduler', {
      stage: 'execution',
    });

    expect(runtimeBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      type: 'debug.scheduler.run.started',
      source: 'debug',
      goalId: 'goal-123',
      taskId: 'workitem-123',
      runId: 'run-123',
      payload: expect.objectContaining({
        type: 'scheduler.run.started',
        source: 'scheduler',
        goalId: 'goal-123',
        workItemId: 'workitem-123',
        runId: 'run-123',
        data: {
          stage: 'execution',
        },
      }),
    }));
  });

  it('stops forwarding debug events after stop is called', () => {
    adapter.start();
    debugEmitter.enable();
    adapter.stop();

    debugEmitter.emitDebug('goal.created', 'scheduler', {
      goalId: 'goal-123',
    });

    expect(runtimeBus.publish).not.toHaveBeenCalled();
  });
});
