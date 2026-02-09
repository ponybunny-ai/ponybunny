'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DebugEvent, SnapshotState, StateDiff } from '@/lib/types';
import { formatTimestamp } from '@/lib/utils';

interface StateInspectorProps {
  currentEvent: DebugEvent | null;
  currentState: SnapshotState | null;
  diff: StateDiff | null;
}

function getStatusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'success';
    case 'failed':
    case 'error':
      return 'destructive';
    case 'in_progress':
    case 'running':
      return 'warning';
    default:
      return 'default';
  }
}

export function StateInspector({
  currentEvent,
  currentState,
  diff,
}: StateInspectorProps) {
  if (!currentEvent || !currentState) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>State Inspector</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No event selected. Play or seek to view state.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>State Inspector</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="event" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="event">Event</TabsTrigger>
            <TabsTrigger value="state">State</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
          </TabsList>

          {/* Event Tab */}
          <TabsContent value="event" className="space-y-4">
            <div className="space-y-2">
              <div>
                <div className="text-sm font-medium">Event Type</div>
                <Badge>{currentEvent.type}</Badge>
              </div>
              <div>
                <div className="text-sm font-medium">Timestamp</div>
                <div className="text-sm text-muted-foreground">
                  {formatTimestamp(currentEvent.timestamp)}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium">Source</div>
                <div className="text-sm text-muted-foreground">{currentEvent.source}</div>
              </div>
              {currentEvent.goalId && (
                <div>
                  <div className="text-sm font-medium">Goal ID</div>
                  <div className="text-sm text-muted-foreground font-mono">
                    {currentEvent.goalId}
                  </div>
                </div>
              )}
              <div>
                <div className="text-sm font-medium">Event Data</div>
                <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs max-h-64">
                  {JSON.stringify(currentEvent.data, null, 2)}
                </pre>
              </div>
            </div>
          </TabsContent>

          {/* State Tab */}
          <TabsContent value="state" className="space-y-4">
            <div className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-2">Goal</div>
                <div className="rounded border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{currentState.goal.title || currentState.goal.id}</span>
                    <Badge variant={getStatusVariant(currentState.goal.status)}>
                      {currentState.goal.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {currentState.goal.id}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">
                  Work Items ({currentState.workItems.length})
                </div>
                <div className="space-y-2 max-h-48 overflow-auto">
                  {currentState.workItems.map((item) => (
                    <div key={item.id} className="rounded border p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{item.title || item.id}</span>
                        <Badge variant={getStatusVariant(item.status)} className="text-xs">
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {currentState.workItems.length === 0 && (
                    <p className="text-sm text-muted-foreground">No work items</p>
                  )}
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">
                  Runs ({currentState.runs.length})
                </div>
                <div className="space-y-2 max-h-48 overflow-auto">
                  {currentState.runs.map((run) => (
                    <div key={run.id} className="rounded border p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono">{run.id}</span>
                        <Badge variant={getStatusVariant(run.status)} className="text-xs">
                          {run.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {currentState.runs.length === 0 && (
                    <p className="text-sm text-muted-foreground">No runs</p>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Changes Tab */}
          <TabsContent value="changes" className="space-y-4">
            {diff && diff.changes.length > 0 ? (
              <div className="space-y-2">
                {diff.changes.map((change, index) => (
                  <div key={index} className="rounded border p-3 space-y-1">
                    <div className="text-sm font-medium font-mono">{change.path}</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground mb-1">Old Value:</div>
                        <pre className="rounded bg-red-50 dark:bg-red-950 p-2 overflow-auto max-h-32">
                          {JSON.stringify(change.oldValue, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">New Value:</div>
                        <pre className="rounded bg-green-50 dark:bg-green-950 p-2 overflow-auto max-h-32">
                          {JSON.stringify(change.newValue, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No changes in this event</p>
            )}
          </TabsContent>

          {/* Metrics Tab */}
          <TabsContent value="metrics" className="space-y-4">
            <div className="space-y-3">
              <div className="rounded border p-3">
                <div className="text-sm font-medium mb-2">LLM Tokens</div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Input</div>
                    <div className="font-mono">{currentState.llmContext.totalTokens.input.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Output</div>
                    <div className="font-mono">{currentState.llmContext.totalTokens.output.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Total</div>
                    <div className="font-mono">
                      {(currentState.llmContext.totalTokens.input + currentState.llmContext.totalTokens.output).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded border p-3">
                <div className="text-sm font-medium mb-2">
                  Active LLM Requests ({currentState.llmContext.activeRequests.length})
                </div>
                <div className="space-y-2 max-h-32 overflow-auto">
                  {currentState.llmContext.activeRequests.map((req) => (
                    <div key={req.id} className="text-sm border-l-2 border-yellow-500 pl-2">
                      <div className="font-mono text-xs">{req.model}</div>
                      <div className="text-xs text-muted-foreground">
                        Started: {formatTimestamp(req.startTime)}
                      </div>
                    </div>
                  ))}
                  {currentState.llmContext.activeRequests.length === 0 && (
                    <p className="text-sm text-muted-foreground">No active requests</p>
                  )}
                </div>
              </div>

              {currentState.metrics.data.toolInvocations !== undefined && (
                <div className="rounded border p-3">
                  <div className="text-sm font-medium mb-2">Tool Invocations</div>
                  <div className="text-2xl font-mono">{currentState.metrics.data.toolInvocations}</div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
