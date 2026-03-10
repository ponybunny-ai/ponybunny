import type { IDaemonEventEmitter } from '../../autonomy/daemon-event-emitter.js';
import type { EventBus } from '../events/event-bus.js';
import { registerDaemonEventForwarders } from './daemon-event-forwarding.js';

/**
 * Gateway-owned attachment boundary for wiring a daemon event source to the
 * gateway event bus. This keeps transport-facing attachment state and
 * forwarding registration out of daemon-owned runtime modules.
 */
export class GatewayDaemonAttachment {
  private connected = false;

  constructor(private readonly eventBus: EventBus) {}

  connect(daemon: IDaemonEventEmitter): void {
    if (this.connected) {
      console.warn('[DaemonBridge] Already connected to a daemon');
      return;
    }

    registerDaemonEventForwarders(this.eventBus, daemon);
    this.connected = true;
    console.log('[DaemonBridge] Connected to daemon');
  }

  isConnected(): boolean {
    return this.connected;
  }

  emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }
}
