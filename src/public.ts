/**
 * Intended live public package surface.
 *
 * Compatibility-oriented root exports live in `src/compatibility.ts`. The
 * historical mixed root barrel remains at `src/index.ts`.
 */

export { WorkOrderDatabase } from './work-order/database/manager.js';
// ADR-001: GoalHarness composition architecture
export { GoalHarness } from './harness/goal-harness.js';
export { HarnessDaemon } from './harness/harness-daemon.js';
export type { IGoalHarness, GoalSubmission, GoalHarnessResult } from './harness/goal-harness-interface.js';
export type { GoalHarnessDependencies } from './harness/goal-harness.js';
export type { HarnessDaemonConfig } from './harness/harness-daemon.js';

export type * from './work-order/types/index.js';
