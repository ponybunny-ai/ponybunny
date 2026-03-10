import {
  DaemonBridge,
  DaemonEventEmitterMixin as GatewayDaemonEventEmitterMixin,
} from '../../../src/gateway/integration/daemon-bridge.js';
import { DaemonEventEmitterMixin as AutonomyDaemonEventEmitterMixin } from '../../../src/autonomy/daemon-event-emitter.js';
import { GatewayDaemonAttachment } from '../../../src/gateway/integration/gateway-daemon-attachment.js';
import type { EventBus } from '../../../src/gateway/events/event-bus.js';

describe('DaemonBridge', () => {
  let bridge: DaemonBridge;
  let mockEventBus: EventBus;
  let daemon: AutonomyDaemonEventEmitterMixin;

  beforeEach(() => {
    mockEventBus = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
    } as unknown as EventBus;

    bridge = new DaemonBridge(mockEventBus);
    daemon = new AutonomyDaemonEventEmitterMixin();
  });

  it('keeps the historical gateway mixin export as a compatibility alias', () => {
    expect(GatewayDaemonEventEmitterMixin).toBe(AutonomyDaemonEventEmitterMixin);
  });

  it('delegates daemon attachment to the gateway-owned attachment boundary', () => {
    const connectSpy = jest.spyOn(GatewayDaemonAttachment.prototype, 'connect');

    bridge.connect(daemon);

    expect(connectSpy).toHaveBeenCalledWith(daemon);
    connectSpy.mockRestore();
  });

  it('delegates connection state and direct emission to the gateway-owned attachment boundary', () => {
    const isConnectedSpy = jest
      .spyOn(GatewayDaemonAttachment.prototype, 'isConnected')
      .mockReturnValue(true);
    const emitSpy = jest.spyOn(GatewayDaemonAttachment.prototype, 'emit');

    expect(bridge.isConnected()).toBe(true);
    bridge.emit('test.event', { ok: true });

    expect(emitSpy).toHaveBeenCalledWith('test.event', { ok: true });
    isConnectedSpy.mockRestore();
    emitSpy.mockRestore();
  });
});
