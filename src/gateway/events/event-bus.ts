/**
 * Event Bus - Internal pub/sub for Gateway events
 */

export type EventHandler<T = unknown> = (data: T) => void;

export interface IEventBus {
  on<T>(event: string, handler: EventHandler<T>): () => void;
  once<T>(event: string, handler: EventHandler<T>): () => void;
  off(event: string, handler: EventHandler): void;
  emit<T>(event: string, data: T): void;
  removeAllListeners(event?: string): void;
}

export type AnyEventHandler = (event: string, data: unknown) => void;

export class EventBus implements IEventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private onceHandlers = new Map<string, Set<EventHandler>>();
  private anyHandlers = new Set<AnyEventHandler>();

  on<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);

    return () => this.off(event, handler as EventHandler);
  }

  once<T>(event: string, handler: EventHandler<T>): () => void {
    if (!this.onceHandlers.has(event)) {
      this.onceHandlers.set(event, new Set());
    }
    this.onceHandlers.get(event)!.add(handler as EventHandler);

    return () => {
      const handlers = this.onceHandlers.get(event);
      if (handlers) {
        handlers.delete(handler as EventHandler);
      }
    };
  }

  off(event: string, handler: EventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
    const onceHandlers = this.onceHandlers.get(event);
    if (onceHandlers) {
      onceHandlers.delete(handler);
    }
  }

  emit<T>(event: string, data: T): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[EventBus] Error in handler for '${event}':`, error);
        }
      }
    }

    const onceHandlers = this.onceHandlers.get(event);
    if (onceHandlers) {
      for (const handler of onceHandlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[EventBus] Error in once handler for '${event}':`, error);
        }
      }
      this.onceHandlers.delete(event);
    }

    // Notify any handlers
    for (const handler of this.anyHandlers) {
      try {
        handler(event, data);
      } catch (error) {
        console.error(`[EventBus] Error in any handler for '${event}':`, error);
      }
    }
  }

  /**
   * Subscribe to all events
   */
  onAny(handler: AnyEventHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.offAny(handler);
  }

  /**
   * Unsubscribe from all events
   */
  offAny(handler: AnyEventHandler): void {
    this.anyHandlers.delete(handler);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
      this.onceHandlers.delete(event);
    } else {
      this.handlers.clear();
      this.onceHandlers.clear();
      this.anyHandlers.clear();
    }
  }

  listenerCount(event: string): number {
    const handlers = this.handlers.get(event)?.size || 0;
    const onceHandlers = this.onceHandlers.get(event)?.size || 0;
    return handlers + onceHandlers;
  }
}

// Singleton instance for global gateway events
export const gatewayEventBus = new EventBus();
