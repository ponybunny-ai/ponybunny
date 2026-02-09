'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Pause, SkipBack, SkipForward, Square } from 'lucide-react';

interface TimelinePlayerProps {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  speed: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  onSpeedChange: (speed: number) => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

export function TimelinePlayer({
  isPlaying,
  currentTime,
  totalDuration,
  speed,
  onPlay,
  onPause,
  onStop,
  onStepBackward,
  onStepForward,
  onSpeedChange,
}: TimelinePlayerProps) {
  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4">
      {/* Playback Controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onStepBackward}
          disabled={isPlaying}
          title="Step Backward"
        >
          <SkipBack className="h-4 w-4" />
        </Button>

        {isPlaying ? (
          <Button
            variant="default"
            size="icon"
            onClick={onPause}
            title="Pause"
          >
            <Pause className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon"
            onClick={onPlay}
            title="Play"
          >
            <Play className="h-4 w-4" />
          </Button>
        )}

        <Button
          variant="outline"
          size="icon"
          onClick={onStepForward}
          disabled={isPlaying}
          title="Step Forward"
        >
          <SkipForward className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={onStop}
          title="Stop"
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>

      {/* Time Display */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono">{formatTime(currentTime)}</span>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-muted-foreground">{formatTime(totalDuration)}</span>
      </div>

      {/* Speed Control */}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Speed:</span>
        <div className="flex gap-1">
          {SPEED_OPTIONS.map((s) => (
            <Button
              key={s}
              variant={speed === s ? 'default' : 'outline'}
              size="sm"
              onClick={() => onSpeedChange(s)}
              className="min-w-[60px]"
            >
              {s}x
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
