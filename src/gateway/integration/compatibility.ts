/**
 * Intentional gateway integration compatibility surface.
 *
 * These exports preserve older gateway-facing imports for scheduler-owned and
 * daemon-attachment compatibility paths. New composition should prefer
 * gateway-owned boundaries or scheduler/runtime-owned modules directly.
 */

export { DaemonBridge, DaemonEventEmitterMixin } from './daemon-bridge.js';
export type { IDaemonEventEmitter } from './daemon-bridge.js';

export {
  ExecutionEngineAdapter,
  SchedulerRepositoryAdapter,
  LocalExecutionAdapter,
  createScheduler,
  type SchedulerFactoryConfig,
  type SchedulerFactoryDependencies,
} from './scheduler-compatibility.js';
