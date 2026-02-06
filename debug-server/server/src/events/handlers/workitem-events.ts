/**
 * WorkItem event handlers.
 */

import type { IEventHandler } from '../types.js';
import type { DebugEvent, EnrichedEvent } from '../../types.js';

export class WorkItemCreatedHandler implements IEventHandler {
  type = 'workitem.created';

  process(event: DebugEvent): EnrichedEvent {
    const workItem = event.data.workItem as Record<string, unknown> | undefined;
    return {
      ...event,
      goalId: event.goalId ?? (workItem?.goal_id as string | undefined),
      workItemId: event.workItemId ?? (workItem?.id as string | undefined),
    };
  }
}

export class WorkItemStatusChangedHandler implements IEventHandler {
  type = 'workitem.status_changed';

  process(event: DebugEvent): EnrichedEvent {
    return {
      ...event,
      workItemId: event.workItemId ?? (event.data.workItemId as string | undefined),
    };
  }
}

export class WorkItemAssignedHandler implements IEventHandler {
  type = 'workitem.assigned';

  process(event: DebugEvent): EnrichedEvent {
    return {
      ...event,
      workItemId: event.workItemId ?? (event.data.workItemId as string | undefined),
    };
  }
}

export const workItemEventHandlers: IEventHandler[] = [
  new WorkItemCreatedHandler(),
  new WorkItemStatusChangedHandler(),
  new WorkItemAssignedHandler(),
];
