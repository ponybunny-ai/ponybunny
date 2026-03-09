import { EventEmitter } from 'events';
import type { AnyEventHandler, EventBus, EventHandler } from './event-bus.js';
import type { RuntimeEvent } from './runtime-event.js';

/**
 * Conservative in-memory event bus for the first migration stage.
 * It isolates subscriber failures so legacy behavior is unaffected while
 * new observers are added in parallel.
 */
export class MemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();
  private readonly anyHandlers = new Set<AnyEventHandler>();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  subscribe(type: string, handler: EventHandler): void {
    this.emitter.on(type, handler);
  }

  subscribeAll(handler: AnyEventHandler): () => void {
    this.anyHandlers.add(handler);
    return () => {
      this.anyHandlers.delete(handler);
    };
  }

  async publish(event: RuntimeEvent): Promise<void> {
    const handlers = this.emitter.listeners(event.type) as EventHandler[];

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[MemoryEventBus] Error in handler for '${event.type}':`, error);
      }
    }

    for (const handler of this.anyHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(`[MemoryEventBus] Error in any handler for '${event.type}':`, error);
      }
    }
  }
}
