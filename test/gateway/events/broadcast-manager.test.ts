import { BroadcastManager } from '../../../src/gateway/events/broadcast-manager.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';
import type { EventEmitter } from '../../../src/gateway/events/event-emitter.js';
import type { ChannelRouter } from '../../../src/gateway/channels/channel-router.js';

describe('BroadcastManager channel adapter events', () => {
  it('broadcasts channel.adapter.status.updated through filtered broadcast path', () => {
    const handlers = new Map<string, (data: unknown) => void>();
    const mockEventBus = {
      on: jest.fn((event: string, handler: (data: unknown) => void) => {
        handlers.set(event, handler);
        return () => {
          handlers.delete(event);
        };
      }),
      emit: jest.fn(),
      onAny: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;

    const mockEventEmitter = {
      emitToSession: jest.fn(() => false),
      emitToGoalSubscribers: jest.fn(() => 0),
      emitToFiltered: jest.fn(() => 2),
    } as unknown as EventEmitter;

    const mockChannelRouter = {
      buildSessionFilter: jest.fn(() => () => true),
    } as unknown as ChannelRouter;

    const manager = new BroadcastManager(mockEventBus, mockEventEmitter, mockChannelRouter);
    manager.start();

    const payload = {
      timestamp: Date.now(),
      reason: 'startup',
      source: 'gateway-startup',
      adapters: [{ channel: 'discord', state: 'running' }],
    };
    const callback = handlers.get('channel.adapter.status.updated');
    expect(callback).toBeDefined();
    callback?.(payload);

    expect((mockEventEmitter.emitToFiltered as unknown as jest.Mock)).toHaveBeenCalledWith(
      'channel.adapter.status.updated',
      payload,
      expect.any(Function)
    );
  });
});
