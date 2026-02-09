/**
 * Snapshot Manager - Handles state capture and compression.
 */

import { gzipSync, gunzipSync } from 'zlib';
import { randomUUID } from 'crypto';
import type { IDebugDataStore } from '../store/types.js';
import type { EnrichedEvent, Snapshot, SnapshotState } from '../types.js';

export interface SnapshotManagerOptions {
  minSnapshotIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<SnapshotManagerOptions> = {
  minSnapshotIntervalMs: 30000, // 30 seconds
};

/**
 * Manages snapshot creation, compression, and storage.
 */
export class SnapshotManager {
  private store: IDebugDataStore;
  private options: Required<SnapshotManagerOptions>;
  private lastSnapshotTime = new Map<string, number>();

  constructor(store: IDebugDataStore, options: SnapshotManagerOptions = {}) {
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Determine if a snapshot should be created for this event.
   */
  shouldCreateSnapshot(event: EnrichedEvent, goalId: string): boolean {
    const now = Date.now();
    const lastSnapshot = this.lastSnapshotTime.get(goalId) || 0;
    const timeSinceLastSnapshot = now - lastSnapshot;

    // Always snapshot on critical events
    if (this.isCriticalEvent(event)) {
      // But rate limit to prevent snapshot spam
      return timeSinceLastSnapshot > this.options.minSnapshotIntervalMs;
    }

    // Time-based fallback - every 5 minutes
    return timeSinceLastSnapshot > 300000;
  }

  /**
   * Create and save a snapshot for the given state.
   */
  async createSnapshot(
    goalId: string,
    state: SnapshotState,
    triggerType: Snapshot['triggerType'],
    triggerEventId?: string
  ): Promise<Snapshot> {
    const now = Date.now();
    const compressed = this.compressSnapshot(state);

    const snapshot: Snapshot = {
      id: randomUUID(),
      goalId,
      timestamp: now,
      triggerType,
      triggerEventId,
      stateData: compressed,
      sizeBytes: compressed.length,
      createdAt: now,
    };

    this.store.saveSnapshot(snapshot);
    this.lastSnapshotTime.set(goalId, now);

    return snapshot;
  }

  /**
   * Compress snapshot state using gzip.
   */
  compressSnapshot(state: SnapshotState): Buffer {
    const json = JSON.stringify(state);
    return gzipSync(json, { level: 6 }); // Balance compression vs speed
  }

  /**
   * Decompress snapshot data.
   */
  decompressSnapshot(data: Buffer): SnapshotState {
    const json = gunzipSync(data).toString();
    return JSON.parse(json);
  }

  /**
   * Check if event is critical and should trigger snapshot.
   */
  private isCriticalEvent(event: EnrichedEvent): boolean {
    // Goal lifecycle
    if (
      event.type === 'goal.created' ||
      event.type === 'goal.completed' ||
      event.type === 'goal.failed'
    ) {
      return true;
    }

    // Phase transitions
    if (event.type === 'phase.transition' || event.type.includes('phase.')) {
      return true;
    }

    // Errors
    if (event.type.includes('.error') || event.type.includes('.failed')) {
      return true;
    }

    // Escalations
    if (event.type.includes('escalat')) {
      return true;
    }

    return false;
  }

  /**
   * Clean up old snapshots for a goal, keeping only the most recent ones.
   */
  pruneSnapshots(goalId: string, keepCount: number = 20): number {
    return this.store.deleteOldSnapshots(goalId, keepCount);
  }
}
