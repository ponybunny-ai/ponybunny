import type {
  GatewayDaemonAttachmentStatus,
  GatewayDaemonLifecycle,
  GatewayDaemonLifecycleSnapshot,
} from './gateway-daemon-lifecycle.js';

export type GatewayDaemonDetachPhase = 'idle' | 'attached-awaiting-daemon-unsubscribe';

export interface GatewayDaemonDetachStatus {
  phase: GatewayDaemonDetachPhase;
  attached: boolean;
  detachSupported: false;
  unsubscribeSupported: false;
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
      detachSupported: false,
      unsubscribeSupported: false,
    };
  }

  return {
    phase: 'attached-awaiting-daemon-unsubscribe',
    attached: true,
    detachSupported: false,
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
