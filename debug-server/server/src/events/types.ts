/**
 * Event types for the event handler system.
 */

import type { DebugEvent, EnrichedEvent } from '../types.js';

/**
 * Event handler interface (factory pattern).
 */
export interface IEventHandler {
  /** Event type this handler processes (supports prefix matching with *) */
  type: string;

  /** Process a raw event into an enriched event */
  process(event: DebugEvent): EnrichedEvent;

  /** Optional: aggregate multiple events */
  aggregate?(events: DebugEvent[]): Record<string, unknown>;
}

/**
 * Check if a handler matches an event type.
 */
export function handlerMatchesType(handlerType: string, eventType: string): boolean {
  if (handlerType.endsWith('*')) {
    return eventType.startsWith(handlerType.slice(0, -1));
  }
  return handlerType === eventType;
}
