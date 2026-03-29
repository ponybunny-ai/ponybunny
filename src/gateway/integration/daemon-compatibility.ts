/**
 * Intentional compatibility surface for the historical gateway daemon bridge.
 *
 * New gateway composition should prefer `GatewayDaemonAttachment` from
 * `./boundaries.js`. This module exists only to preserve older daemon-bridge
 * imports without implying gateway ownership of the daemon event emitter.
 */

export {
  DaemonEventEmitterMixin,
  type IDaemonEventEmitter,
} from '../../runtime/events/daemon-event-emitter.js';
import type { EventBus } from '../events/event-bus.js';
import type { IDaemonEventEmitter } from '../../runtime/events/daemon-event-emitter.js';
import {
  GatewayDaemonAttachment,
  type GatewayDaemonAttachmentStatus,
  type GatewayDaemonAttachmentSurface,
} from './gateway-daemon-attachment.js';

/**
 * Historical gateway compatibility shell around the gateway-owned daemon
 * attachment boundary. New gateway composition should prefer
 * `GatewayDaemonAttachment` directly.
 */
export class DaemonBridge implements GatewayDaemonAttachmentSurface {
  private readonly attachment: GatewayDaemonAttachment;

  constructor(eventBus: EventBus) {
    this.attachment = new GatewayDaemonAttachment(eventBus);
  }

  connect(daemon: IDaemonEventEmitter): void {
    this.attachment.connect(daemon);
  }

  getStatus(): GatewayDaemonAttachmentStatus {
    return this.attachment.getStatus();
  }

  isConnected(): boolean {
    return this.getStatus().connected;
  }

  emit(event: string, data: unknown): void {
    this.attachment.emit(event, data);
  }
}
