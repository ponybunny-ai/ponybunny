import type { DebugEvent } from '@/lib/types';
import { EventItem } from './event-item';
import { ScrollArea } from '@/components/ui/scroll-area';

interface EventListProps {
  events: DebugEvent[];
}

export function EventList({ events }: EventListProps) {
  if (events.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No events found
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-12rem)]">
      <div className="space-y-4 p-4">
        {events.map((event) => (
          <EventItem key={event.id} event={event} />
        ))}
      </div>
    </ScrollArea>
  );
}
