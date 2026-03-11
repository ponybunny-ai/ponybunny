/**
 * Intended live gateway integration boundaries.
 *
 * These exports represent gateway-owned attachment/transport seams that remain
 * part of the active gateway surface.
 */

export {
  GatewayDaemonAttachment,
  type GatewayDaemonAttachmentPhase,
  type GatewayDaemonAttachmentStatus,
  type GatewayDaemonDetachPhase,
  type GatewayDaemonDetachStatus,
  type GatewayDaemonDetachSurface,
  type GatewayDaemonOperationState,
  type GatewayDaemonAttachmentSurface,
} from './gateway-daemon-attachment.js';

export { SchedulerBridge } from './scheduler-bridge.js';
