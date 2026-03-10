/**
 * Compatibility shim around the scheduler-owned default composition entry point.
 */

import { createDefaultScheduler } from '../../scheduler/composition/index.js';
import type {
  DefaultSchedulerConfig as SchedulerFactoryConfig,
  DefaultSchedulerDependencies as SchedulerFactoryDependencies,
} from '../../scheduler/composition/index.js';
import type { SchedulerCore } from '../../scheduler/core/index.js';

export type { SchedulerFactoryConfig, SchedulerFactoryDependencies };

/**
 * Create a fully configured SchedulerCore instance
 */
export function createScheduler(
  deps: SchedulerFactoryDependencies,
  config?: SchedulerFactoryConfig
): SchedulerCore {
  return createDefaultScheduler(deps, config);
}
