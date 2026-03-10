/**
 * Intentional public gateway compatibility surface.
 *
 * Historical gateway entrypoints that preserve older imports should route
 * through this module instead of being treated as part of the live gateway API.
 */

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
