import type { IDaemonEventEmitter } from '../../runtime/events/daemon-event-emitter.js';
import type { EventBus } from '../events/event-bus.js';
import {
  registerDaemonEventForwarders,
  type DaemonEventForwardingBinding,
} from './daemon-event-forwarding.js';
import {
  GatewayDaemonLifecycle,
  type GatewayDaemonAttachmentPhase,
  type GatewayDaemonAttachmentStatus,
} from './gateway-daemon-lifecycle.js';
import {
  getGatewayDaemonDetachStatus,
  getGatewayDaemonOperationState,
  type GatewayDaemonDetachStatus,
  type GatewayDaemonDetachSurface,
  type GatewayDaemonOperationState,
} from './gateway-daemon-detach-operations.js';

export type { GatewayDaemonAttachmentPhase, GatewayDaemonAttachmentStatus };
export type {
  GatewayDaemonDetachPhase,
  GatewayDaemonDetachStatus,
  GatewayDaemonDetachSurface,
  GatewayDaemonOperationState,
} from './gateway-daemon-detach-operations.js';

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
export class GatewayDaemonAttachment
implements GatewayDaemonAttachmentSurface, GatewayDaemonDetachSurface {
  private readonly lifecycle = new GatewayDaemonLifecycle();
  private forwardingBinding: DaemonEventForwardingBinding | null = null;

  constructor(private readonly eventBus: EventBus) {}

  connect(daemon: IDaemonEventEmitter): void {
    if (this.lifecycle.hasAttachedDaemon()) {
      console.warn('[GatewayDaemonAttachment] Already connected to a daemon');
      return;
    }

    this.forwardingBinding = registerDaemonEventForwarders(this.eventBus, daemon);
    this.lifecycle.attach(daemon);
    console.log('[GatewayDaemonAttachment] Connected to daemon');
  }

  detach(): void {
    if (this.forwardingBinding !== null) {
      this.forwardingBinding.release();
      this.forwardingBinding = null;
    }

    if (!this.lifecycle.hasAttachedDaemon()) {
      return;
    }

    this.lifecycle.resetToDetached();
  }

  isConnected(): boolean {
    return this.lifecycle.hasAttachedDaemon();
  }

  getStatus(): GatewayDaemonAttachmentStatus {
    return this.lifecycle.getStatus();
  }

  getDetachStatus(): GatewayDaemonDetachStatus {
    return getGatewayDaemonDetachStatus(this.getStatus());
  }

  getOperationState(): GatewayDaemonOperationState {
    return getGatewayDaemonOperationState(this.lifecycle);
  }

  emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }
}
