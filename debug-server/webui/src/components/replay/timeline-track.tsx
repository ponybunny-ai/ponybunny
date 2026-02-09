'use client';

import { useMemo } from 'react';
import type { DebugEvent, TimelineMetadata } from '@/lib/types';
import { categorizeEvent } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TimelineTrackProps {
  timeline: TimelineMetadata;
  events: DebugEvent[];
  currentTimestamp: number;
  onSeek: (timestamp: number) => void;
}

export function TimelineTrack({
  timeline,
  events,
  currentTimestamp,
  onSeek,
}: TimelineTrackProps) {
  const { startTime, endTime, durationMs, phaseBoundaries, errorMarkers, llmCallSpans } = timeline;

  // Calculate position as percentage
  const getPosition = (timestamp: number) => {
    if (durationMs === 0) return 0;
    return ((timestamp - startTime) / durationMs) * 100;
  };

  const currentPosition = getPosition(currentTimestamp);

  // Group events by type for different lanes
  const eventMarkers = useMemo(() => {
    return events.map((event) => ({
      event,
      position: getPosition(event.timestamp),
      category: categorizeEvent(event.type),
    }));
  }, [events, startTime, durationMs]);

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = (x / rect.width) * 100;
    const timestamp = startTime + (percentage / 100) * durationMs;
    onSeek(Math.floor(timestamp));
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'goal': return 'bg-blue-500';
      case 'workitem': return 'bg-purple-500';
      case 'run': return 'bg-green-500';
      case 'llm': return 'bg-yellow-500';
      case 'tool': return 'bg-cyan-500';
      case 'state': return 'bg-pink-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      {/* Phase Lane */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Phases</div>
        <div className="relative h-8 cursor-pointer rounded bg-muted" onClick={handleTrackClick}>
          {phaseBoundaries.map((phase, index) => {
            const start = getPosition(phase.startTime);
            const width = getPosition(phase.endTime) - start;
            const colors = ['bg-blue-400', 'bg-purple-400', 'bg-green-400', 'bg-yellow-400', 'bg-pink-400'];

            return (
              <div
                key={index}
                className={cn('absolute h-full', colors[index % colors.length])}
                style={{
                  left: `${start}%`,
                  width: `${width}%`,
                }}
                title={phase.phase}
              >
                <span className="flex h-full items-center justify-center text-xs font-medium text-white truncate px-2">
                  {phase.phase}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event Lane */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Events</div>
        <div className="relative h-6 cursor-pointer rounded bg-muted" onClick={handleTrackClick}>
          {eventMarkers.map((marker, index) => (
            <div
              key={index}
              className={cn(
                'absolute h-full w-1 opacity-60 hover:opacity-100',
                getCategoryColor(marker.category)
              )}
              style={{ left: `${marker.position}%` }}
              title={`${marker.event.type} - ${new Date(marker.event.timestamp).toLocaleTimeString()}`}
            />
          ))}
        </div>
      </div>

      {/* Error Lane */}
      {errorMarkers.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Errors</div>
          <div className="relative h-4 cursor-pointer rounded bg-muted" onClick={handleTrackClick}>
            {errorMarkers.map((error, index) => (
              <div
                key={index}
                className="absolute h-full w-2 bg-red-500 opacity-80 hover:opacity-100"
                style={{ left: `${getPosition(error.timestamp)}%` }}
                title={`Error at ${new Date(error.timestamp).toLocaleTimeString()}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* LLM Call Lane */}
      {llmCallSpans.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">LLM Calls</div>
          <div className="relative h-4 cursor-pointer rounded bg-muted" onClick={handleTrackClick}>
            {llmCallSpans.map((span, index) => {
              const start = getPosition(span.startTime);
              const width = getPosition(span.endTime) - start;

              return (
                <div
                  key={index}
                  className="absolute h-full bg-green-500 opacity-60 hover:opacity-100"
                  style={{
                    left: `${start}%`,
                    width: `${Math.max(width, 0.5)}%`,
                  }}
                  title={`${span.model} - ${span.tokens} tokens`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Progress Indicator */}
      <div className="relative h-2 rounded bg-muted">
        <div
          className="absolute h-full w-1 bg-primary shadow-lg"
          style={{ left: `${currentPosition}%` }}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded bg-blue-500" />
          <span>Goal</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded bg-purple-500" />
          <span>WorkItem</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded bg-green-500" />
          <span>Run</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded bg-yellow-500" />
          <span>LLM</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-3 w-3 rounded bg-cyan-500" />
          <span>Tool</span>
        </div>
        {errorMarkers.length > 0 && (
          <div className="flex items-center gap-1">
            <div className="h-3 w-3 rounded bg-red-500" />
            <span>Error</span>
          </div>
        )}
      </div>
    </div>
  );
}
