'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Bot, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Zap, 
  Terminal,
  Activity,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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

  const isStreaming = stream.status === 'streaming';
  const isError = stream.status === 'error';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isCompleted = stream.status === 'completed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3 }}
      layout
    >
      <Card className={cn(
        "overflow-hidden border-l-4 transition-all duration-300 hover:shadow-md mb-4",
        isStreaming ? "border-l-primary shadow-primary/5" : 
        isError ? "border-l-destructive" : "border-l-emerald-500/50"
      )}>
        <CardHeader className="pb-2 bg-muted/30 pt-3 px-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-full flex items-center justify-center",
                isStreaming ? "bg-primary/10 text-primary" :
                isError ? "bg-destructive/10 text-destructive" :
                "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              )}>
                {isStreaming ? <Bot className="w-4 h-4 animate-pulse" /> :
                 isError ? <AlertCircle className="w-4 h-4" /> :
                 <CheckCircle2 className="w-4 h-4" />}
              </div>
              
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{stream.model}</span>
                  {isStreaming && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] animate-pulse bg-primary/10 text-primary border-primary/20">
                      Generating...
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {duration}s
                  </span>
                  {stream.tokensUsed && (
                    <span className="flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {stream.tokensUsed} toks
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              {stream.goalId && (
                <Badge variant="outline" className="text-[10px] font-mono opacity-70 hover:opacity-100 transition-opacity">
                  Goal: {stream.goalId.slice(0, 8)}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-4 pt-2">
          <div className={cn(
            "font-mono text-sm whitespace-pre-wrap rounded-md p-3 transition-colors mt-2",
            "bg-background border border-border/50",
            isStreaming && "border-primary/20 bg-primary/5"
          )}>
            {content || <span className="text-muted-foreground italic opacity-50">Waiting for tokens...</span>}
            {isStreaming && (
              <motion.span 
                animate={{ opacity: [1, 0, 1] }}
                transition={{ repeat: Infinity, duration: 0.8 }}
                className="inline-block w-2 h-4 bg-primary ml-1 align-middle rounded-sm"
              />
            )}
          </div>

          {(stream.workItemId || stream.finishReason) && (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground border-t pt-2 border-border/50">
              <div className="flex items-center gap-2">
                {stream.workItemId && (
                  <span className="flex items-center gap-1 font-mono opacity-60" title={`WorkItem: ${stream.workItemId}`}>
                    <Terminal className="w-3 h-3" />
                    {stream.workItemId.slice(0, 8)}
                  </span>
                )}
              </div>
              {stream.finishReason && (
                <span className="flex items-center gap-1 opacity-60">
                  <Activity className="w-3 h-3" />
                  {stream.finishReason}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
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
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-xl bg-muted/20"
      >
        <div className="p-4 rounded-full bg-muted mb-3">
          <Sparkles className="w-6 h-6 opacity-50" />
        </div>
        <p className="font-medium">No active streams</p>
        <p className="text-sm opacity-70">LLM activity will appear here in real-time</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      <AnimatePresence mode="popLayout">
        {streamArray.map((stream) => (
          <StreamingResponseCard key={stream.requestId} stream={stream} />
        ))}
      </AnimatePresence>
    </div>
  );
}
