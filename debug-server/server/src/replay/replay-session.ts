/**
 * Replay Session - Manages WebSocket-based replay playback.
 */

import type { WebSocket } from 'ws';
import type { IDebugDataStore } from '../store/types.js';
import type { ReplayEngine } from './replay-engine.js';
import type { EnrichedEvent, SnapshotState, StateDiff } from '../types.js';

export interface ReplaySessionOptions {
  speed?: number;
  batchSize?: number;
  batchIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<ReplaySessionOptions> = {
  speed: 1,
  batchSize: 10,
  batchIntervalMs: 50,
};

/**
 * Manages a replay session for a WebSocket client.
 */
export class ReplaySession {
  private goalId: string;
  private replayEngine: ReplayEngine;
  private store: IDebugDataStore;
  private ws: WebSocket;
  private options: Required<ReplaySessionOptions>;

  private events: EnrichedEvent[] = [];
  private currentIndex = 0;
  private isPlaying = false;
  private playbackTimer: NodeJS.Timeout | null = null;
  private batchTimer: NodeJS.Timeout | null = null;
  private eventBuffer: Array<{ event: EnrichedEvent; state: SnapshotState; diff: StateDiff }> = [];
  private previousState: SnapshotState | null = null;

  constructor(
    goalId: string,
    replayEngine: ReplayEngine,
    store: IDebugDataStore,
    ws: WebSocket,
    options: ReplaySessionOptions = {}
  ) {
    this.goalId = goalId;
    this.replayEngine = replayEngine;
    this.store = store;
    this.ws = ws;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Start the replay session.
   */
  async start(): Promise<void> {
    // Load all events for this goal
    this.events = this.store.queryEvents({ goalId: this.goalId });
    this.events.sort((a, b) => a.timestamp - b.timestamp);

    if (this.events.length === 0) {
      this.sendMessage({ type: 'replay.complete' });
      return;
    }

    this.currentIndex = 0;
    this.isPlaying = true;

    // Start batch timer
    this.startBatchTimer();

    // Start playback
    await this.playback();
  }

  /**
   * Pause playback.
   */
  pause(): void {
    this.isPlaying = false;
    this.stopPlaybackTimer();
  }

  /**
   * Resume playback.
   */
  resume(): void {
    if (this.currentIndex >= this.events.length) {
      return; // Already at end
    }

    this.isPlaying = true;
    this.playback().catch(console.error);
  }

  /**
   * Seek to a specific timestamp.
   */
  async seek(timestamp: number): Promise<void> {
    // Find the event closest to the timestamp
    const index = this.events.findIndex((e) => e.timestamp >= timestamp);

    if (index === -1) {
      this.currentIndex = this.events.length - 1;
    } else {
      this.currentIndex = index;
    }

    // Reconstruct state at this point
    const event = this.events[this.currentIndex];
    const result = await this.replayEngine.reconstructState(this.goalId, event.timestamp);

    // Send current state
    this.sendMessage({
      type: 'replay.event',
      event,
      state: result.state,
      diff: { changes: [] },
    });

    this.previousState = result.state;
  }

  /**
   * Step forward or backward one event.
   */
  async step(direction: 'forward' | 'backward'): Promise<void> {
    const wasPlaying = this.isPlaying;
    this.pause();

    if (direction === 'forward') {
      if (this.currentIndex < this.events.length - 1) {
        this.currentIndex++;
        await this.sendCurrentEvent();
      }
    } else {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        await this.sendCurrentEvent();
      }
    }

    if (wasPlaying) {
      this.resume();
    }
  }

  /**
   * Set playback speed.
   */
  setSpeed(speed: number): void {
    this.options.speed = speed;
  }

  /**
   * Stop the replay session.
   */
  stop(): void {
    this.isPlaying = false;
    this.stopPlaybackTimer();
    this.stopBatchTimer();
    this.flushBuffer();
  }

  /**
   * Main playback loop.
   */
  private async playback(): Promise<void> {
    while (this.isPlaying && this.currentIndex < this.events.length) {
      const event = this.events[this.currentIndex];

      // Reconstruct state
      let state: SnapshotState;
      let diff: StateDiff;

      if (this.previousState) {
        state = this.replayEngine.applyEvent(this.previousState, event);
        diff = this.replayEngine.computeDiff(this.previousState, state);
      } else {
        const result = await this.replayEngine.reconstructState(this.goalId, event.timestamp);
        state = result.state;
        diff = { changes: [] };
      }

      // Add to buffer
      this.eventBuffer.push({ event, state, diff });

      // Flush if buffer is full
      if (this.eventBuffer.length >= this.options.batchSize) {
        this.flushBuffer();
      }

      this.previousState = state;
      this.currentIndex++;

      // Calculate delay based on speed and time between events
      if (this.currentIndex < this.events.length) {
        const nextEvent = this.events[this.currentIndex];
        const timeDiff = nextEvent.timestamp - event.timestamp;
        const delay = Math.max(10, timeDiff / this.options.speed);

        await this.sleep(delay);
      }
    }

    // Flush remaining events
    this.flushBuffer();

    if (this.currentIndex >= this.events.length) {
      this.sendMessage({ type: 'replay.complete' });
      this.isPlaying = false;
    }
  }

  /**
   * Send current event to client.
   */
  private async sendCurrentEvent(): Promise<void> {
    const event = this.events[this.currentIndex];
    const result = await this.replayEngine.reconstructState(this.goalId, event.timestamp);

    const diff = this.previousState
      ? this.replayEngine.computeDiff(this.previousState, result.state)
      : { changes: [] };

    this.sendMessage({
      type: 'replay.event',
      event,
      state: result.state,
      diff,
    });

    this.previousState = result.state;
  }

  /**
   * Flush event buffer to client.
   */
  private flushBuffer(): void {
    if (this.eventBuffer.length === 0) {
      return;
    }

    this.sendMessage({
      type: 'replay.batch',
      events: this.eventBuffer,
    });

    this.eventBuffer = [];
  }

  /**
   * Start batch flush timer.
   */
  private startBatchTimer(): void {
    this.batchTimer = setInterval(() => {
      this.flushBuffer();
    }, this.options.batchIntervalMs);
  }

  /**
   * Stop batch timer.
   */
  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Stop playback timer.
   */
  private stopPlaybackTimer(): void {
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  /**
   * Send message to WebSocket client.
   */
  private sendMessage(message: unknown): void {
    if (this.ws.readyState === 1) { // WebSocket.OPEN
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.playbackTimer = setTimeout(resolve, ms);
    });
  }
}
