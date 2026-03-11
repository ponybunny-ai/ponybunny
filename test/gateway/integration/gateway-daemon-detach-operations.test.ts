import { DaemonEventEmitterMixin } from '../../../src/autonomy/daemon-event-emitter.js';
import {
  getGatewayDaemonDetachStatus,
  getGatewayDaemonOperationState,
} from '../../../src/gateway/integration/gateway-daemon-detach-operations.js';
import { GatewayDaemonLifecycle } from '../../../src/gateway/integration/gateway-daemon-lifecycle.js';

describe('gateway-daemon-detach-operations', () => {
  it('describes the detached state as an idle no-op detach boundary', () => {
    expect(getGatewayDaemonDetachStatus({
      phase: 'detached',
      connected: false,
      connectedAt: null,
    })).toEqual({
      phase: 'idle',
      attached: false,
      detachSupported: true,
      unsubscribeSupported: false,
    });
  });

  it('derives attached detach-facing state from the gateway lifecycle snapshot', () => {
    const lifecycle = new GatewayDaemonLifecycle();
    const daemon = new DaemonEventEmitterMixin();

    lifecycle.attach(daemon);

    expect(getGatewayDaemonOperationState(lifecycle)).toEqual({
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
        detachSupported: true,
        unsubscribeSupported: false,
      },
    });
  });

  it('returns to the existing idle detached projection after lifecycle reset', () => {
    const lifecycle = new GatewayDaemonLifecycle();
    const daemon = new DaemonEventEmitterMixin();

    lifecycle.attach(daemon);
    lifecycle.resetToDetached();

    expect(getGatewayDaemonOperationState(lifecycle)).toEqual({
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
        detachSupported: true,
        unsubscribeSupported: false,
      },
    });
  });
});
