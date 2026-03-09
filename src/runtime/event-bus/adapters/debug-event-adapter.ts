import { randomUUID } from 'crypto';
import { debugEmitter } from '../../../debug/emitter.js';
import type { DebugEvent } from '../../../debug/types.js';
import type { EventBus as RuntimeEventBus } from '../event-bus.js';
import type { RuntimeEvent } from '../runtime-event.js';
import { runtimeEventBus } from '../runtime-event-bus.js';

export class DebugEventAdapter {
  private started = false;
  private readonly handler = (event: DebugEvent) => {
    const runtimeEvent = this.toRuntimeEvent(event);
    void this.bus.publish(runtimeEvent).catch((error) => {
      console.error(`[DebugEventAdapter] Failed to publish '${runtimeEvent.type}' runtime event:`, error);
    });
  };

  constructor(private readonly bus: RuntimeEventBus = runtimeEventBus) {}

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    debugEmitter.onDebug(this.handler);
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    debugEmitter.offDebug(this.handler);
  }

  private toRuntimeEvent(event: DebugEvent): RuntimeEvent {
    return {
      id: randomUUID(),
      type: `debug.${event.type}`,
      source: 'debug',
      timestamp: event.timestamp,
      payload: event,
      ...(typeof event.goalId === 'string' && event.goalId.length > 0 ? { goalId: event.goalId } : {}),
      ...(typeof event.workItemId === 'string' && event.workItemId.length > 0
        ? { taskId: event.workItemId }
        : {}),
      ...(typeof event.runId === 'string' && event.runId.length > 0 ? { runId: event.runId } : {}),
    };
  }
}
