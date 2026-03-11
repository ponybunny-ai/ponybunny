import type {
  GatewayDaemonAttachmentStatus,
  GatewayDaemonLifecycle,
  GatewayDaemonLifecycleSnapshot,
} from './gateway-daemon-lifecycle.js';

export type GatewayDaemonDetachPhase = 'idle' | 'attached-awaiting-daemon-unsubscribe';

export interface GatewayDaemonDetachStatus {
  phase: GatewayDaemonDetachPhase;
  attached: boolean;
  detachSupported: boolean;
  unsubscribeSupported: boolean;
}

export interface GatewayDaemonOperationState {
  attachment: GatewayDaemonLifecycleSnapshot;
  detach: GatewayDaemonDetachStatus;
}

export interface GatewayDaemonDetachSurface {
  getDetachStatus(): GatewayDaemonDetachStatus;
  getOperationState(): GatewayDaemonOperationState;
}

export function getGatewayDaemonDetachStatus(
  attachment: GatewayDaemonAttachmentStatus
): GatewayDaemonDetachStatus {
  if (!attachment.connected) {
    return {
      phase: 'idle',
      attached: false,
      detachSupported: true,
      unsubscribeSupported: false,
    };
  }

  return {
    phase: 'attached-awaiting-daemon-unsubscribe',
    attached: true,
    detachSupported: true,
    unsubscribeSupported: false,
  };
}

export function getGatewayDaemonOperationState(
  lifecycle: GatewayDaemonLifecycle
): GatewayDaemonOperationState {
  const attachment = lifecycle.getSnapshot();

  return {
    attachment,
    detach: getGatewayDaemonDetachStatus(attachment.status),
  };
}
