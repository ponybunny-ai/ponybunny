'use client';

import { Card, CardContent } from '@/components/ui/card';

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

interface StreamingMessageProps {
  stream: StreamingResponse;
}

export function StreamingMessage({ stream }: StreamingMessageProps) {
  const content = stream.chunks.join('');

  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <span className="text-sm">🤖</span>
      </div>
      <div className="flex-1 space-y-2">
        <Card className="bg-muted/50">
          <CardContent className="p-4">
            <div className="prose prose-sm max-w-none dark:prose-invert">
              {content}
              {stream.status === 'streaming' && (
                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle">▊</span>
              )}
            </div>
          </CardContent>
        </Card>
        {stream.status === 'completed' && (
          <div className="text-xs text-muted-foreground px-2">
            {stream.model} • {stream.tokensUsed} tokens
          </div>
        )}
        {stream.status === 'error' && (
          <div className="text-xs text-destructive px-2">
            Stream error
          </div>
        )}
      </div>
    </div>
  );
}

interface StreamingListProps {
  streams: Map<string, StreamingResponse>;
  goalId?: string;
}

export function StreamingList({ streams, goalId }: StreamingListProps) {
  // Filter streams by goalId if provided
  const filteredStreams = goalId
    ? Array.from(streams.values()).filter((s) => s.goalId === goalId)
    : Array.from(streams.values());

  // Sort by start time (newest first)
  const sortedStreams = filteredStreams.sort((a, b) => b.startTime - a.startTime);

  if (sortedStreams.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {sortedStreams.map((stream) => (
        <StreamingMessage key={stream.requestId} stream={stream} />
      ))}
    </div>
  );
}
