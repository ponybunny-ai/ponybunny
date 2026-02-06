/**
 * Run event handlers.
 */

import type { IEventHandler } from '../types.js';
import type { DebugEvent, EnrichedEvent } from '../../types.js';

export class RunStartedHandler implements IEventHandler {
  type = 'run.started';

  process(event: DebugEvent): EnrichedEvent {
    const run = event.data.run as Record<string, unknown> | undefined;
    return {
      ...event,
      workItemId: event.workItemId ?? (run?.work_item_id as string | undefined),
      runId: event.runId ?? (run?.id as string | undefined),
    };
  }
}

export class RunCompletedHandler implements IEventHandler {
  type = 'run.completed';

  process(event: DebugEvent): EnrichedEvent {
    return {
      ...event,
      runId: event.runId ?? (event.data.runId as string | undefined),
    };
  }
}

export class RunFailedHandler implements IEventHandler {
  type = 'run.failed';

  process(event: DebugEvent): EnrichedEvent {
    return {
      ...event,
      runId: event.runId ?? (event.data.runId as string | undefined),
    };
  }
}

export const runEventHandlers: IEventHandler[] = [
  new RunStartedHandler(),
  new RunCompletedHandler(),
  new RunFailedHandler(),
];
