'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface StreamingResponse {
  requestId: string;
  goalId?: string;
  workItemId?: string;
  runId?: string;
  model: string;
  chunks: string[];
  startTime: number;
  endTime?: number;
  status: 'streaming' | 'completed' | 'error';
  tokensUsed?: number;
  finishReason?: string;
}

interface StreamingResponseProps {
  stream: StreamingResponse;
}

export function StreamingResponseCard({ stream }: StreamingResponseProps) {
  const content = stream.chunks.join('');
  const duration = stream.endTime
    ? ((stream.endTime - stream.startTime) / 1000).toFixed(2)
    : ((Date.now() - stream.startTime) / 1000).toFixed(2);

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{stream.model}</Badge>
            {stream.status === 'streaming' && (
              <Badge variant="default" className="animate-pulse">
                Streaming...
              </Badge>
            )}
            {stream.status === 'completed' && (
              <Badge variant="secondary">Completed</Badge>
            )}
            {stream.status === 'error' && (
              <Badge variant="destructive">Error</Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {duration}s
            {stream.tokensUsed && ` • ${stream.tokensUsed} tokens`}
          </div>
        </div>
        {stream.goalId && (
          <div className="text-xs text-muted-foreground mt-1">
            Goal: {stream.goalId.slice(0, 8)}
            {stream.workItemId && ` • WorkItem: ${stream.workItemId.slice(0, 8)}`}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="font-mono text-sm whitespace-pre-wrap bg-muted p-4 rounded-md">
          {content}
          {stream.status === 'streaming' && (
            <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1">▊</span>
          )}
        </div>
        {stream.status === 'completed' && stream.finishReason && (
          <div className="text-xs text-muted-foreground mt-2">
            Finish reason: {stream.finishReason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface StreamingListProps {
  streams: Map<string, StreamingResponse>;
  maxDisplay?: number;
}

export function StreamingList({ streams, maxDisplay = 5 }: StreamingListProps) {
  const streamArray = Array.from(streams.values())
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, maxDisplay);

  if (streamArray.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No active or recent streams
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {streamArray.map((stream) => (
        <StreamingResponseCard key={stream.requestId} stream={stream} />
      ))}
    </div>
  );
}
