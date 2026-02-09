'use client';

import { useDebug } from '@/components/providers/debug-provider';
import { StreamingList } from '@/components/llm/streaming-response';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function StreamsPage() {
  const { state } = useDebug();

  const activeCount = Array.from(state.activeStreams.values()).filter(
    (s) => s.status === 'streaming'
  ).length;

  const completedCount = Array.from(state.activeStreams.values()).filter(
    (s) => s.status === 'completed'
  ).length;

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">LLM Streams</h1>
        <p className="text-muted-foreground">
          Real-time streaming responses from LLM providers
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Active Streams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Streams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{state.activeStreams.size}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Streams</CardTitle>
        </CardHeader>
        <CardContent>
          <StreamingList streams={state.activeStreams} maxDisplay={10} />
        </CardContent>
      </Card>
    </div>
  );
}
