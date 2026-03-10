import type { IDaemonEventEmitter } from '../../autonomy/daemon-event-emitter.js';
import type { EventBus } from '../events/event-bus.js';
import { registerDaemonEventForwarders } from './daemon-event-forwarding.js';

export type GatewayDaemonAttachmentPhase = 'detached' | 'attached';

export interface GatewayDaemonAttachmentStatus {
  phase: GatewayDaemonAttachmentPhase;
  connected: boolean;
  connectedAt: number | null;
}

export interface GatewayDaemonAttachmentSurface {
  connect(daemon: IDaemonEventEmitter): void;
  getStatus(): GatewayDaemonAttachmentStatus;
  emit(event: string, data: unknown): void;
}

/**
 * Gateway-owned attachment boundary for wiring a daemon event source to the
 * gateway event bus. This keeps transport-facing attachment state and
 * forwarding registration out of daemon-owned runtime modules.
 */
export class GatewayDaemonAttachment implements GatewayDaemonAttachmentSurface {
  private status: GatewayDaemonAttachmentStatus = {
    phase: 'detached',
    connected: false,
    connectedAt: null,
  };

  constructor(private readonly eventBus: EventBus) {}

  connect(daemon: IDaemonEventEmitter): void {
    if (this.status.connected) {
      console.warn('[DaemonBridge] Already connected to a daemon');
      return;
    }

    registerDaemonEventForwarders(this.eventBus, daemon);
    this.status = {
      phase: 'attached',
      connected: true,
      connectedAt: Date.now(),
    };
    console.log('[DaemonBridge] Connected to daemon');
  }

  isConnected(): boolean {
    return this.status.connected;
  }

  getStatus(): GatewayDaemonAttachmentStatus {
    return { ...this.status };
  }

  emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }
}
