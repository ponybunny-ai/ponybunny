import { EventBus as GatewayEventBus } from '../../../src/gateway/events/event-bus.js';
import { GatewayEventAdapter } from '../../../src/runtime/event-bus/adapters/gateway-event-adapter.js';
import type { EventBus as RuntimeEventBus } from '../../../src/runtime/event-bus/event-bus.js';

describe('GatewayEventAdapter', () => {
  let gatewayEventBus: GatewayEventBus;
  let runtimeBus: jest.Mocked<RuntimeEventBus>;
  let adapter: GatewayEventAdapter;

  beforeEach(() => {
    gatewayEventBus = new GatewayEventBus();
    runtimeBus = {
      publish: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn(),
    };
    adapter = new GatewayEventAdapter(gatewayEventBus, runtimeBus);
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('republishes selected gateway events into the runtime event bus', () => {
    adapter.start();

    const payload = {
      goalId: 'goal-123',
      workItemId: 'workitem-123',
      runId: 'run-123',
      selectedModel: 'gpt-5',
    };

    gatewayEventBus.emit('run.started', payload);

    expect(runtimeBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run.started',
      source: 'gateway',
      timestamp: 1_700_000_000_000,
      goalId: 'goal-123',
      taskId: 'workitem-123',
      runId: 'run-123',
      payload,
    }));
    expect(runtimeBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
    }));
  });

  it('ignores gateway events outside the initial bridge set', () => {
    adapter.start();

    gatewayEventBus.emit('goal.updated', { goalId: 'goal-123' });

    expect(runtimeBus.publish).not.toHaveBeenCalled();
  });

  it('stops forwarding events after stop is called', () => {
    adapter.start();
    adapter.stop();

    gatewayEventBus.emit('goal.completed', { goalId: 'goal-123' });

    expect(runtimeBus.publish).not.toHaveBeenCalled();
  });
});
