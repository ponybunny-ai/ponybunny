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

// Scheduler compatibility surfaces
export {
  ExecutionEngineAdapter,
  SchedulerRepositoryAdapter,
} from '../../scheduler/composition/index.js';
export { LocalExecutionAdapter } from '../../runtime/execution-boundary/index.js';

// Scheduler Factory (new)
export { createScheduler } from './scheduler-factory.js';
export type { SchedulerFactoryConfig, SchedulerFactoryDependencies } from './scheduler-factory.js';
