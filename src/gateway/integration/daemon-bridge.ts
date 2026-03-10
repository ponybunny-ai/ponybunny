/**
 * Daemon Bridge - Connects AutonomyDaemon events to Gateway
 *
 * This bridge allows the AutonomyDaemon to emit events that get
 * broadcast to connected Gateway clients.
 */

export {
  DaemonEventEmitterMixin,
  type IDaemonEventEmitter,
} from '../../autonomy/daemon-event-emitter.js';
import type { EventBus } from '../events/event-bus.js';
import type { IDaemonEventEmitter } from '../../autonomy/daemon-event-emitter.js';
import { GatewayDaemonAttachment } from './gateway-daemon-attachment.js';

/**
 * Historical gateway compatibility shell around the gateway-owned daemon
 * attachment boundary. New gateway composition should prefer
 * GatewayDaemonAttachment directly.
 */
export class DaemonBridge {
  private readonly attachment: GatewayDaemonAttachment;

  constructor(eventBus: EventBus) {
    this.attachment = new GatewayDaemonAttachment(eventBus);
  }

  connect(daemon: IDaemonEventEmitter): void {
    this.attachment.connect(daemon);
  }

  isConnected(): boolean {
    return this.attachment.isConnected();
  }

  emit(event: string, data: unknown): void {
    this.attachment.emit(event, data);
  }
}
