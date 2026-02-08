'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useDebug } from '@/components/providers/debug-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EventList } from '@/components/events/event-list';
import { formatTimestamp } from '@/lib/utils';

function getStatusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'error':
      return 'destructive';
    case 'in_progress':
    case 'executing':
      return 'warning';
    default:
      return 'default';
  }
}

export default function GoalDetailPage() {
  const params = useParams();
  const goalId = params.id as string;
  const { state, loadGoal } = useDebug();

  useEffect(() => {
    if (goalId) {
      loadGoal(goalId);
    }
  }, [goalId, loadGoal]);

  const goal = state.goals.get(goalId);
  const workItems = state.workItems.get(goalId) || [];
  const goalEvents = state.events.filter((e) => e.goalId === goalId);

  if (!goal) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading goal...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">{goal.title || goal.id}</h1>
        <p className="text-muted-foreground">Goal ID: {goal.id}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Goal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium">Status</div>
              <Badge variant={getStatusVariant(goal.status)}>
                {goal.status}
              </Badge>
            </div>
            <div>
              <div className="text-sm font-medium">Last Updated</div>
              <div className="text-sm text-muted-foreground">
                {formatTimestamp(goal.updatedAt)}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Data</div>
              <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(goal.data, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work Items ({workItems.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {workItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No work items</p>
            ) : (
              <div className="space-y-2">
                {workItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {item.title || item.id}
                      </span>
                      <Badge variant={getStatusVariant(item.status)}>
                        {item.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.id}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Related Events ({goalEvents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <EventList events={goalEvents} />
        </CardContent>
      </Card>
    </div>
  );
}
