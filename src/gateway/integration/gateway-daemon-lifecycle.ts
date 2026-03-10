import type { IDaemonEventEmitter } from '../../autonomy/daemon-event-emitter.js';

export type GatewayDaemonAttachmentPhase = 'detached' | 'attached';

export interface GatewayDaemonAttachmentStatus {
  phase: GatewayDaemonAttachmentPhase;
  connected: boolean;
  connectedAt: number | null;
}

export interface GatewayDaemonLifecycleSnapshot {
  daemon: IDaemonEventEmitter | null;
  status: GatewayDaemonAttachmentStatus;
}

/**
 * Gateway-owned lifecycle bookkeeping for the current daemon attachment.
 *
 * This keeps the attached daemon reference and status snapshot together in one
 * place so future detach work has an explicit local home without changing
 * current attach/detach behavior.
 */
export class GatewayDaemonLifecycle {
  private daemon: IDaemonEventEmitter | null = null;
  private connectedAt: number | null = null;

  hasAttachedDaemon(): boolean {
    return this.daemon !== null;
  }

  attach(daemon: IDaemonEventEmitter): GatewayDaemonLifecycleSnapshot {
    this.daemon = daemon;
    this.connectedAt = Date.now();
    return this.getSnapshot();
  }

  getStatus(): GatewayDaemonAttachmentStatus {
    return {
      phase: this.daemon === null ? 'detached' : 'attached',
      connected: this.daemon !== null,
      connectedAt: this.connectedAt,
    };
  }

  getSnapshot(): GatewayDaemonLifecycleSnapshot {
    return {
      daemon: this.daemon,
      status: this.getStatus(),
    };
  }
}
