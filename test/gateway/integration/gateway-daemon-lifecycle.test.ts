import { DaemonEventEmitterMixin } from '../../../src/autonomy/daemon-event-emitter.js';
import { GatewayDaemonLifecycle } from '../../../src/gateway/integration/gateway-daemon-lifecycle.js';

describe('GatewayDaemonLifecycle', () => {
  it('tracks the attached daemon reference and derived status snapshot together', () => {
    const lifecycle = new GatewayDaemonLifecycle();
    const daemon = new DaemonEventEmitterMixin();

    expect(lifecycle.hasAttachedDaemon()).toBe(false);
    expect(lifecycle.getSnapshot()).toEqual({
      daemon: null,
      status: {
        phase: 'detached',
        connected: false,
        connectedAt: null,
      },
    });

    const snapshot = lifecycle.attach(daemon);

    expect(lifecycle.hasAttachedDaemon()).toBe(true);
    expect(snapshot).toEqual({
      daemon,
      status: {
        phase: 'attached',
        connected: true,
        connectedAt: expect.any(Number),
      },
    });
    expect(lifecycle.getSnapshot()).toEqual(snapshot);
  });
});
