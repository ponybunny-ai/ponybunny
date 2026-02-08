'use client';

import { useEffect, useState } from 'react';
import { useDebug } from '@/components/providers/debug-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EventList } from '@/components/events/event-list';
import { Button } from '@/components/ui/button';
import type { EventFilter } from '@/lib/types';

export default function EventsPage() {
  const { state, loadEvents } = useDebug();
  const [filter, setFilter] = useState<EventFilter>({ limit: 100 });

  useEffect(() => {
    loadEvents(filter);
  }, [filter, loadEvents]);

  const handleClearFilter = () => {
    setFilter({ limit: 100 });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Events</h1>
          <p className="text-muted-foreground">
            Real-time event stream from the debug server
          </p>
        </div>
        <Button onClick={handleClearFilter} variant="outline">
          Clear Filters
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event Stream ({state.events.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <EventList events={state.events} />
        </CardContent>
      </Card>
    </div>
  );
}
