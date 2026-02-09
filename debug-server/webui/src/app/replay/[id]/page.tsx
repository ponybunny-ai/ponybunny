'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { debugApiClient } from '@/lib/api-client';
import type { DebugEvent, TimelineMetadata, SnapshotState, StateDiff, ReplayEventData } from '@/lib/types';
import { TimelinePlayer } from '@/components/replay/timeline-player';
import { TimelineTrack } from '@/components/replay/timeline-track';
import { StateInspector } from '@/components/replay/state-inspector';
import { NavigationPanel } from '@/components/replay/navigation-panel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ReplayPage() {
  const params = useParams();
  const goalId = params.id as string;

  const [timeline, setTimeline] = useState<TimelineMetadata | null>(null);
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [currentEvent, setCurrentEvent] = useState<DebugEvent | null>(null);
  const [currentState, setCurrentState] = useState<SnapshotState | null>(null);
  const [currentDiff, setCurrentDiff] = useState<StateDiff | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load timeline and events
  useEffect(() => {
    if (!goalId) return;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Load timeline metadata
        const timelineData = await debugApiClient.getTimeline(goalId);
        setTimeline(timelineData);

        // Load all events for this goal
        const eventsData = await debugApiClient.getReplayEvents(
          goalId,
          timelineData.startTime,
          timelineData.endTime,
          10000 // Load up to 10k events
        );
        setEvents(eventsData.events.sort((a, b) => a.timestamp - b.timestamp));

        // Load initial state
        if (eventsData.events.length > 0) {
          const firstEvent = eventsData.events[0];
          setCurrentEvent(firstEvent);
          const state = await debugApiClient.getStateAtTimestamp(goalId, firstEvent.timestamp);
          setCurrentState(state.state);
        }
      } catch (err) {
        setError((err as Error).message);
        console.error('Failed to load replay data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [goalId]);

  // Connect WebSocket for replay control
  useEffect(() => {
    debugApiClient.connectWebSocket();

    const unsubscribeEvent = debugApiClient.on('replay.event', (data) => {
      const eventData = data as ReplayEventData;
      setCurrentEvent(eventData.event);
      setCurrentState(eventData.state);
      setCurrentDiff(eventData.diff);

      // Update current index
      const index = events.findIndex((e) => e.id === eventData.event.id);
      if (index !== -1) {
        setCurrentEventIndex(index);
      }
    });

    const unsubscribeBatch = debugApiClient.on('replay.batch', (data) => {
      const batch = (data as { events: ReplayEventData[] }).events;
      if (batch.length > 0) {
        const last = batch[batch.length - 1];
        setCurrentEvent(last.event);
        setCurrentState(last.state);
        setCurrentDiff(last.diff);

        const index = events.findIndex((e) => e.id === last.event.id);
        if (index !== -1) {
          setCurrentEventIndex(index);
        }
      }
    });

    const unsubscribeComplete = debugApiClient.on('replay.complete', () => {
      setIsPlaying(false);
    });

    const unsubscribeError = debugApiClient.on('replay.error', (data) => {
      const errorData = data as { error: string };
      setError(errorData.error);
      setIsPlaying(false);
    });

    return () => {
      unsubscribeEvent();
      unsubscribeBatch();
      unsubscribeComplete();
      unsubscribeError();
      debugApiClient.stopReplay();
    };
  }, [goalId, events]);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    debugApiClient.startReplay(goalId, speed);
  }, [goalId, speed]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    debugApiClient.pauseReplay();
  }, []);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    debugApiClient.stopReplay();
    // Reset to first event
    if (events.length > 0) {
      setCurrentEventIndex(0);
      setCurrentEvent(events[0]);
    }
  }, [events]);

  const handleStepBackward = useCallback(() => {
    debugApiClient.stepReplay('backward');
  }, []);

  const handleStepForward = useCallback(() => {
    debugApiClient.stepReplay('forward');
  }, []);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    setSpeed(newSpeed);
    if (isPlaying) {
      debugApiClient.setReplaySpeed(newSpeed);
    }
  }, [isPlaying]);

  const handleSeek = useCallback((timestamp: number) => {
    debugApiClient.seekReplay(timestamp);
  }, []);

  const handleJumpToEvent = useCallback(async (index: number) => {
    if (index < 0 || index >= events.length) return;

    const event = events[index];
    setCurrentEventIndex(index);
    setCurrentEvent(event);

    try {
      const state = await debugApiClient.getStateAtTimestamp(goalId, event.timestamp);
      setCurrentState(state.state);

      if (index > 0) {
        const diff = await debugApiClient.getEventDiff(goalId, event.id);
        setCurrentDiff(diff);
      } else {
        setCurrentDiff({ changes: [] });
      }
    } catch (err) {
      console.error('Failed to load state:', err);
    }
  }, [events, goalId]);

  const handleJumpToNextError = useCallback(() => {
    const nextErrorIndex = events.findIndex(
      (e, i) => i > currentEventIndex && (e.type.includes('error') || e.type.includes('failed'))
    );
    if (nextErrorIndex !== -1) {
      handleJumpToEvent(nextErrorIndex);
    }
  }, [events, currentEventIndex, handleJumpToEvent]);

  const handleJumpToNextPhase = useCallback(() => {
    const nextPhaseIndex = events.findIndex(
      (e, i) => i > currentEventIndex && e.type.includes('phase')
    );
    if (nextPhaseIndex !== -1) {
      handleJumpToEvent(nextPhaseIndex);
    }
  }, [events, currentEventIndex, handleJumpToEvent]);

  const handleJumpToNextLLM = useCallback(() => {
    const nextLLMIndex = events.findIndex(
      (e, i) => i > currentEventIndex && e.type.includes('llm')
    );
    if (nextLLMIndex !== -1) {
      handleJumpToEvent(nextLLMIndex);
    }
  }, [events, currentEventIndex, handleJumpToEvent]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading replay data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!timeline || events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">No replay data available for this goal.</p>
      </div>
    );
  }

  const currentTimestamp = currentEvent?.timestamp || timeline.startTime;

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-3xl font-bold">Replay: {goalId}</h1>
        <p className="text-muted-foreground">
          {events.length} events • {Math.floor(timeline.durationMs / 1000)}s duration
        </p>
      </div>

      {/* Timeline Player */}
      <TimelinePlayer
        isPlaying={isPlaying}
        currentTime={currentTimestamp - timeline.startTime}
        totalDuration={timeline.durationMs}
        speed={speed}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onStepBackward={handleStepBackward}
        onStepForward={handleStepForward}
        onSpeedChange={handleSpeedChange}
      />

      {/* Timeline Track */}
      <TimelineTrack
        timeline={timeline}
        events={events}
        currentTimestamp={currentTimestamp}
        onSeek={handleSeek}
      />

      {/* Main Content Grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* State Inspector (2/3 width) */}
        <div className="lg:col-span-2">
          <StateInspector
            currentEvent={currentEvent}
            currentState={currentState}
            diff={currentDiff}
          />
        </div>

        {/* Navigation Panel (1/3 width) */}
        <div>
          <NavigationPanel
            events={events}
            currentEventIndex={currentEventIndex}
            onJumpToEvent={handleJumpToEvent}
            onJumpToNextError={handleJumpToNextError}
            onJumpToNextPhase={handleJumpToNextPhase}
            onJumpToNextLLM={handleJumpToNextLLM}
          />
        </div>
      </div>
    </div>
  );
}
