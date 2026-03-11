/**
 * Intentional gateway-side compatibility surface for historical scheduler
 * composition and adapter imports. Scheduler-owned code should import these
 * concerns from scheduler/runtime namespaces directly.
 */

import { createDefaultScheduler } from '../../scheduler/composition/index.js';
import type {
  DefaultSchedulerConfig as SchedulerFactoryConfig,
  DefaultSchedulerDependencies as SchedulerFactoryDependencies,
} from '../../scheduler/composition/index.js';
import type { SchedulerCore } from '../../scheduler/core/index.js';

export {
  ExecutionEngineAdapter,
  SchedulerRepositoryAdapter,
} from '../../scheduler/composition/index.js';
export { LocalExecutionAdapter } from '../../runtime/execution-boundary/index.js';
export type { SchedulerFactoryConfig, SchedulerFactoryDependencies };

export function createScheduler(
  deps: SchedulerFactoryDependencies,
  config?: SchedulerFactoryConfig
): SchedulerCore {
  return createDefaultScheduler(deps, config);
}
