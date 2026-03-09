import type { RuntimeEvent } from './runtime-event.js';

export type EventHandler = (event: RuntimeEvent) => void | Promise<void>;

export interface EventBus {
  publish(event: RuntimeEvent): Promise<void>;
  subscribe(type: string, handler: EventHandler): void;
}
