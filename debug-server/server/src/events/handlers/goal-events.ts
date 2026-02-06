/**
 * Goal event handlers.
 */

import type { IEventHandler } from '../types.js';
import type { DebugEvent, EnrichedEvent } from '../../types.js';

export class GoalCreatedHandler implements IEventHandler {
  type = 'goal.created';

  process(event: DebugEvent): EnrichedEvent {
    const goal = event.data.goal as Record<string, unknown> | undefined;
    return {
      ...event,
      goalId: event.goalId ?? (goal?.id as string | undefined),
    };
  }
}

export class GoalStatusChangedHandler implements IEventHandler {
  type = 'goal.status_changed';

  process(event: DebugEvent): EnrichedEvent {
    return {
      ...event,
      goalId: event.goalId ?? (event.data.goalId as string | undefined),
    };
  }
}

export class GoalCompletedHandler implements IEventHandler {
  type = 'goal.completed';

  process(event: DebugEvent): EnrichedEvent {
    return {
      ...event,
      goalId: event.goalId ?? (event.data.goalId as string | undefined),
    };
  }
}

export const goalEventHandlers: IEventHandler[] = [
  new GoalCreatedHandler(),
  new GoalStatusChangedHandler(),
  new GoalCompletedHandler(),
];
