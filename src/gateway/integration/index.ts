/**
 * Gateway Integration Module
 *
 * Provides bridges and adapters to connect Gateway with other system components.
 */

// Daemon Bridge (existing)
export { DaemonBridge, DaemonEventEmitterMixin } from './daemon-bridge.js';
export type { IDaemonEventEmitter } from './daemon-bridge.js';

// Scheduler Bridge (new)
export { SchedulerBridge } from './scheduler-bridge.js';

// Intentional scheduler compatibility surface
export {
  ExecutionEngineAdapter,
  SchedulerRepositoryAdapter,
  LocalExecutionAdapter,
  createScheduler,
  type SchedulerFactoryConfig,
  type SchedulerFactoryDependencies,
} from './scheduler-compatibility.js';
