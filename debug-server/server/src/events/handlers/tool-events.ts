/**
 * Tool event handlers.
 */

import type { IEventHandler } from '../types.js';
import type { DebugEvent, EnrichedEvent } from '../../types.js';

// Track invocation start times for duration calculation
const invocationStartTimes = new Map<string, number>();

export class ToolInvokeHandler implements IEventHandler {
  type = 'tool.invoke';

  process(event: DebugEvent): EnrichedEvent {
    const invocationId = event.data.invocationId as string | undefined;
    if (invocationId) {
      invocationStartTimes.set(invocationId, event.timestamp);
    }
    return { ...event };
  }
}

export class ToolResultHandler implements IEventHandler {
  type = 'tool.result';

  process(event: DebugEvent): EnrichedEvent {
    const invocationId = event.data.invocationId as string | undefined;
    let duration: number | undefined;

    if (invocationId) {
      const startTime = invocationStartTimes.get(invocationId);
      if (startTime) {
        duration = event.timestamp - startTime;
        invocationStartTimes.delete(invocationId);
      }
    }

    // Use durationMs from event data if available
    const durationMs = event.data.durationMs as number | undefined;

    return {
      ...event,
      duration: duration ?? durationMs,
    };
  }
}

export class ToolErrorHandler implements IEventHandler {
  type = 'tool.error';

  process(event: DebugEvent): EnrichedEvent {
    const invocationId = event.data.invocationId as string | undefined;
    if (invocationId) {
      invocationStartTimes.delete(invocationId);
    }
    return { ...event };
  }
}

export const toolEventHandlers: IEventHandler[] = [
  new ToolInvokeHandler(),
  new ToolResultHandler(),
  new ToolErrorHandler(),
];
