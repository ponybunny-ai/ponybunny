/**
 * Intended live public package surface.
 *
 * Compatibility-oriented root exports live in `src/compatibility.ts`. The
 * historical mixed root barrel remains at `src/index.ts`.
 */

export { WorkOrderDatabase } from './work-order/database/manager.js';
export { AutonomyDaemon } from './autonomy/daemon.js';

export type * from './work-order/types/index.js';
