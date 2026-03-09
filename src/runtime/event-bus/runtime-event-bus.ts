import { MemoryEventBus } from './memory-event-bus.js';

/**
 * Temporary singleton for the adapter-based migration.
 * Existing systems stay in place until runtime events are wired explicitly.
 */
export const runtimeEventBus = new MemoryEventBus();
