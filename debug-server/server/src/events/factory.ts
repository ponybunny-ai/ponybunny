/**
 * Debug Event Factory - Manages event handlers using factory pattern.
 */

import type { IEventHandler } from './types.js';
import type { DebugEvent, EnrichedEvent } from '../types.js';

import { goalEventHandlers } from './handlers/goal-events.js';
import { workItemEventHandlers } from './handlers/workitem-events.js';
import { runEventHandlers } from './handlers/run-events.js';
import { llmEventHandlers } from './handlers/llm-events.js';
import { toolEventHandlers } from './handlers/tool-events.js';

/**
 * Factory for processing debug events.
 */
export class DebugEventFactory {
  private handlers = new Map<string, IEventHandler>();

  constructor() {
    // Register all built-in handlers
    this.registerHandlers(goalEventHandlers);
    this.registerHandlers(workItemEventHandlers);
    this.registerHandlers(runEventHandlers);
    this.registerHandlers(llmEventHandlers);
    this.registerHandlers(toolEventHandlers);
  }

  /**
   * Register a single event handler.
   */
  register(handler: IEventHandler): void {
    this.handlers.set(handler.type, handler);
  }

  /**
   * Register multiple event handlers.
   */
  registerHandlers(handlers: IEventHandler[]): void {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  /**
   * Process a raw event into an enriched event.
   */
  process(event: DebugEvent): EnrichedEvent {
    // Try exact match first
    let handler = this.handlers.get(event.type);

    // If no exact match, try prefix handlers
    if (!handler) {
      for (const [type, h] of this.handlers) {
        if (type.endsWith('*') && event.type.startsWith(type.slice(0, -1))) {
          handler = h;
          break;
        }
      }
    }

    if (handler) {
      return handler.process(event);
    }

    // Unknown type - pass through as-is
    return event as EnrichedEvent;
  }

  /**
   * Get handler for a specific event type.
   */
  getHandler(type: string): IEventHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * List all registered handler types.
   */
  listHandlerTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// Singleton instance
export const debugEventFactory = new DebugEventFactory();
