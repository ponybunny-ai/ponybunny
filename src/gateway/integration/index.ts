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

// Scheduler Adapters (new)
export { SchedulerRepositoryAdapter } from './scheduler-repository-adapter.js';
export { ExecutionEngineAdapter } from './execution-engine-adapter.js';

// Scheduler Factory (new)
export { createScheduler } from './scheduler-factory.js';
export type { SchedulerFactoryConfig, SchedulerFactoryDependencies } from './scheduler-factory.js';
