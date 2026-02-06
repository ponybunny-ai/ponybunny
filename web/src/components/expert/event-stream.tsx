'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GatewayEvent } from '@/components/providers/gateway-provider';

interface EventStreamProps {
  events: GatewayEvent[];
  maxEvents?: number;
}

export function EventStream({ events, maxEvents = 50 }: EventStreamProps) {
  const displayEvents = events.slice(0, maxEvents);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm font-medium">Event Stream</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="px-4 pb-4 space-y-1">
            {displayEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No events yet...</p>
            ) : (
              displayEvents.map((event) => (
                <EventItem key={event.id} event={event} />
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function EventItem({ event }: { event: GatewayEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const eventColor = getEventColor(event.type);

  return (
    <div className="flex items-start gap-2 text-xs font-mono">
      <span className="text-muted-foreground shrink-0">{time}</span>
      <span className={`${eventColor} truncate`}>{event.type}</span>
    </div>
  );
}

function getEventColor(eventType: string): string {
  if (eventType.includes('created')) return 'text-green-600 dark:text-green-400';
  if (eventType.includes('completed')) return 'text-blue-600 dark:text-blue-400';
  if (eventType.includes('failed')) return 'text-red-600 dark:text-red-400';
  if (eventType.includes('updated')) return 'text-yellow-600 dark:text-yellow-400';
  if (eventType.includes('started')) return 'text-purple-600 dark:text-purple-400';
  return 'text-foreground';
}
