'use client';

import { useEffect } from 'react';
import { useGateway } from '@/components/providers/gateway-provider';
import { apiClient } from '@/lib/api-client';
import type { GatewayEventType } from '@/lib/types';

export function useEvents(filter?: GatewayEventType[]) {
  const { state } = useGateway();

  const events = filter
    ? state.events.filter((e) => filter.includes(e.type as GatewayEventType))
    : state.events;

  return {
    events,
    allEvents: state.events,
  };
}

export function useEventSubscription(
  eventType: GatewayEventType | '*',
  handler: (data: unknown) => void
) {
  useEffect(() => {
    const unsubscribe = apiClient.on(eventType, handler);
    return unsubscribe;
  }, [eventType, handler]);
}

export function useGoalEvents(goalId: string | null) {
  const { state } = useGateway();

  // Filter events for this goal
  const goalEvents = state.events.filter((e) => {
    const data = e.data as { goal_id?: string; id?: string };
    return data?.goal_id === goalId || data?.id === goalId;
  });

  return goalEvents;
}
