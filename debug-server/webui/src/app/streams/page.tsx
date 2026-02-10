'use client';

import { useDebug } from '@/components/providers/debug-provider';
import { StreamingList } from '@/components/llm/streaming-response';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, CheckCircle2, Zap, MessageSquare } from 'lucide-react';

export default function StreamsPage() {
  const { state } = useDebug();

  const activeCount = Array.from(state.activeStreams.values()).filter(
    (s) => s.status === 'streaming'
  ).length;

  const completedCount = Array.from(state.activeStreams.values()).filter(
    (s) => s.status === 'completed'
  ).length;

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <MessageSquare className="w-8 h-8 text-primary" />
          LLM Streams
        </h1>
        <p className="text-muted-foreground text-lg">
          Real-time monitoring of autonomous agent thought processes and responses.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-l-4 border-l-primary shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Streams</CardTitle>
            <Activity className="h-4 w-4 text-primary animate-pulse" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{activeCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Currently generating tokens
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500/50 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{completedCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Successfully finished
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-muted shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Streams</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{state.activeStreams.size}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Total session activity
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-tight">Live Feed</h2>
          <div className="text-sm text-muted-foreground">
            Showing last 10 streams
          </div>
        </div>
        <StreamingList streams={state.activeStreams} maxDisplay={10} />
      </div>
    </div>
  );
}
