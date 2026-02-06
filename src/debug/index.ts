/**
 * Debug instrumentation API.
 *
 * This module provides the instrumentation system for PonyBunny.
 * It allows various modules to emit debug events that can be collected
 * and visualized by the Debug Server.
 *
 * @example
 * ```typescript
 * import { debug, debugEmitter } from './debug/index.js';
 *
 * // Enable debug mode
 * debugEmitter.enable();
 *
 * // Set context for event correlation
 * debug.setContext({ goalId: 'goal-123' });
 *
 * // Emit events
 * debug.goalCreated({ id: 'goal-123', title: 'My Goal' });
 * debug.llmRequest('req-1', 'gpt-4', messages);
 *
 * // Clear context when done
 * debug.clearContext();
 * ```
 */

export { debugEmitter } from './emitter.js';
export { debug } from './debug.js';
export type {
  DebugEvent,
  DebugContext,
  EnrichedEvent,
  EventFilter,
  TimeRange,
  AggregatedMetrics,
} from './types.js';
