/**
 * Intentional public gateway compatibility surface.
 *
 * Historical gateway entrypoints that preserve older imports should route
 * through this module instead of being treated as part of the live gateway API.
 *
 * This includes older integration exports plus compatibility-only gateway
 * event typing/helpers such as legacy `task.*` client events.
 */

export {
  isGatewayCompatibilityEventType,
} from './types.js';
export type {
  AnyGatewayEventType,
  GatewayCompatibilityEvent,
  GatewayCompatibilityEventType,
} from './types.js';

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
} from './integration/compatibility.js';
