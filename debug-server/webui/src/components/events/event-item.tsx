import type { DebugEvent, EventCategory } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatTimestamp, formatDuration } from '@/lib/utils';
import { categorizeEvent } from '@/lib/types';

interface EventItemProps {
  event: DebugEvent;
}

function getCategoryColor(category: EventCategory): 'default' | 'success' | 'warning' | 'info' | 'destructive' {
  switch (category) {
    case 'goal':
      return 'info';
    case 'workitem':
      return 'success';
    case 'run':
      return 'warning';
    case 'llm':
      return 'info';
    case 'tool':
      return 'default';
    case 'state':
      return 'success';
    case 'system':
      return 'default';
    default:
      return 'default';
  }
}

export function EventItem({ event }: EventItemProps) {
  const category = categorizeEvent(event.type);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={getCategoryColor(category)}>{category}</Badge>
              <span className="text-sm font-medium">{event.type}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(event.timestamp)}
            </span>
          </div>

          <div className="text-sm text-muted-foreground">
            Source: {event.source}
          </div>

          {event.duration && (
            <div className="text-sm text-muted-foreground">
              Duration: {formatDuration(event.duration)}
            </div>
          )}

          {(event.goalId || event.workItemId || event.runId) && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {event.goalId && <div>Goal: {event.goalId}</div>}
              {event.workItemId && <div>WorkItem: {event.workItemId}</div>}
              {event.runId && <div>Run: {event.runId}</div>}
            </div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              View data
            </summary>
            <pre className="mt-2 overflow-auto rounded bg-muted p-2">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}
