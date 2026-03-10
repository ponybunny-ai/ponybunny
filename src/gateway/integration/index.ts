/**
 * Historical mixed gateway integration barrel.
 *
 * Prefer `./boundaries.js` for live gateway-owned seams and
 * `./compatibility.js` for import-preserving compatibility paths.
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
  SchedulerBridge,
} from './boundaries.js';

export {
  DaemonBridge,
  DaemonEventEmitterMixin,
  type IDaemonEventEmitter,
  ExecutionEngineAdapter,
  SchedulerRepositoryAdapter,
  LocalExecutionAdapter,
  createScheduler,
  type SchedulerFactoryConfig,
  type SchedulerFactoryDependencies,
} from './compatibility.js';
