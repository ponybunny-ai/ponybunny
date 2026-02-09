/**
 * Replay Engine - Reconstructs state from snapshots and events.
 */

import type { IDebugDataStore } from '../store/types.js';
import type {
  EnrichedEvent,
  SnapshotState,
  ReplayState,
  StateDiff,
  StateChange,
  CachedWorkItem,
  CachedRun,
  AggregatedMetrics,
} from '../types.js';
import { SnapshotManager } from './snapshot-manager.js';

interface LRUCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
}

class SimpleLRU<K, V> implements LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }
}

export interface ReplayEngineOptions {
  maxEventsInMemory?: number;
  stateCacheSize?: number;
}

const DEFAULT_OPTIONS: Required<ReplayEngineOptions> = {
  maxEventsInMemory: 10000,
  stateCacheSize: 100,
};

/**
 * Reconstructs state from snapshots and events.
 */
export class ReplayEngine {
  private store: IDebugDataStore;
  private snapshotManager: SnapshotManager;
  private options: Required<ReplayEngineOptions>;
  private stateCache: LRUCache<number, SnapshotState>;

  constructor(
    store: IDebugDataStore,
    snapshotManager: SnapshotManager,
    options: ReplayEngineOptions = {}
  ) {
    this.store = store;
    this.snapshotManager = snapshotManager;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.stateCache = new SimpleLRU(this.options.stateCacheSize);
  }

  /**
   * Reconstruct state at a specific timestamp.
   */
  async reconstructState(goalId: string, targetTimestamp: number): Promise<ReplayState> {
    try {
      // 1. Find nearest snapshot before target
      const snapshot = this.store.getNearestSnapshot(goalId, targetTimestamp);

      // 2. Load snapshot state or create empty state
      let state: SnapshotState;
      let snapshotTimestamp = 0;

      if (snapshot) {
        try {
          state = this.snapshotManager.decompressSnapshot(snapshot.stateData);
          snapshotTimestamp = snapshot.timestamp;
        } catch (error) {
          console.warn(`Snapshot ${snapshot.id} corrupted, falling back to full replay`);
          state = this.createEmptyState(goalId);
        }
      } else {
        state = this.createEmptyState(goalId);
      }

      // 3. Fetch events between snapshot and target
      const events = this.store.queryEvents({
        goalId,
        startTime: snapshotTimestamp,
        endTime: targetTimestamp,
      });

      // Sort by timestamp ascending
      events.sort((a, b) => a.timestamp - b.timestamp);

      // 4. Replay events to reconstruct state
      for (const event of events) {
        state = this.applyEvent(state, event);
      }

      return {
        timestamp: targetTimestamp,
        state,
        snapshotUsed: snapshotTimestamp || undefined,
        eventsReplayed: events.length,
      };
    } catch (error) {
      throw new Error(`Failed to reconstruct state: ${(error as Error).message}`);
    }
  }

  /**
   * Apply an event to a state, returning the new state.
   */
  applyEvent(state: SnapshotState, event: EnrichedEvent): SnapshotState {
    // Deep clone to avoid mutations
    const newState = this.cloneState(state);

    switch (event.type) {
      case 'goal.created': {
        const goal = event.data.goal as Record<string, unknown> | undefined;
        if (goal && typeof goal.id === 'string') {
          newState.goal = {
            id: goal.id,
            status: (goal.status as string) || 'queued',
            title: goal.title as string | undefined,
            data: goal,
            updatedAt: event.timestamp,
          };
        }
        break;
      }

      case 'goal.status_changed': {
        const newStatus = event.data.to as string;
        if (newStatus) {
          newState.goal.status = newStatus;
          newState.goal.updatedAt = event.timestamp;
        }
        break;
      }

      case 'workitem.created': {
        const workItem = event.data.workItem as Record<string, unknown> | undefined;
        if (workItem && typeof workItem.id === 'string') {
          const cached: CachedWorkItem = {
            id: workItem.id,
            goalId: (workItem.goal_id as string) || event.goalId || '',
            status: (workItem.status as string) || 'queued',
            title: workItem.title as string | undefined,
            data: workItem,
            updatedAt: event.timestamp,
          };
          newState.workItems.push(cached);
        }
        break;
      }

      case 'workitem.status_changed': {
        const workItemId = event.workItemId || (event.data.workItemId as string);
        const newStatus = event.data.to as string;
        if (workItemId && newStatus) {
          const wi = newState.workItems.find((w) => w.id === workItemId);
          if (wi) {
            wi.status = newStatus;
            wi.updatedAt = event.timestamp;
          }
        }
        break;
      }

      case 'run.started': {
        const run = event.data.run as Record<string, unknown> | undefined;
        if (run && typeof run.id === 'string') {
          const cached: CachedRun = {
            id: run.id,
            workItemId: (run.work_item_id as string) || event.workItemId || '',
            status: 'running',
            data: run,
            updatedAt: event.timestamp,
          };
          newState.runs.push(cached);
        }
        break;
      }

      case 'run.completed':
      case 'run.failed': {
        const runId = event.runId || (event.data.runId as string);
        const newStatus = event.type === 'run.completed' ? 'completed' : 'failed';
        if (runId) {
          const run = newState.runs.find((r) => r.id === runId);
          if (run) {
            run.status = newStatus;
            run.updatedAt = event.timestamp;
          }
        }
        break;
      }

      case 'llm.request': {
        const requestId = event.data.requestId as string;
        const model = event.data.model as string;
        if (requestId && model) {
          newState.llmContext.activeRequests.push({
            id: requestId,
            model,
            startTime: event.timestamp,
          });
        }
        break;
      }

      case 'llm.response':
      case 'llm.error': {
        const requestId = event.data.requestId as string;
        if (requestId) {
          newState.llmContext.activeRequests = newState.llmContext.activeRequests.filter(
            (req) => req.id !== requestId
          );
        }
        break;
      }

      case 'llm.tokens': {
        newState.llmContext.totalTokens.input += (event.data.inputTokens as number) || 0;
        newState.llmContext.totalTokens.output += (event.data.outputTokens as number) || 0;
        break;
      }
    }

    return newState;
  }

  /**
   * Compute diff between two states.
   */
  computeDiff(before: SnapshotState, after: SnapshotState): StateDiff {
    const changes: StateChange[] = [];

    // Compare goal state
    if (before.goal.status !== after.goal.status) {
      changes.push({
        path: 'goal.status',
        oldValue: before.goal.status,
        newValue: after.goal.status,
      });
    }

    // Compare work items
    const beforeWIs = new Map(before.workItems.map((w) => [w.id, w]));
    const afterWIs = new Map(after.workItems.map((w) => [w.id, w]));

    for (const [id, afterWI] of afterWIs) {
      const beforeWI = beforeWIs.get(id);
      if (!beforeWI) {
        changes.push({
          path: `workItems.${id}`,
          oldValue: null,
          newValue: afterWI,
        });
      } else if (beforeWI.status !== afterWI.status) {
        changes.push({
          path: `workItems.${id}.status`,
          oldValue: beforeWI.status,
          newValue: afterWI.status,
        });
      }
    }

    // Compare runs
    const beforeRuns = new Map(before.runs.map((r) => [r.id, r]));
    const afterRuns = new Map(after.runs.map((r) => [r.id, r]));

    for (const [id, afterRun] of afterRuns) {
      const beforeRun = beforeRuns.get(id);
      if (!beforeRun) {
        changes.push({
          path: `runs.${id}`,
          oldValue: null,
          newValue: afterRun,
        });
      } else if (beforeRun.status !== afterRun.status) {
        changes.push({
          path: `runs.${id}.status`,
          oldValue: beforeRun.status,
          newValue: afterRun.status,
        });
      }
    }

    // Compare LLM context
    if (before.llmContext.totalTokens.input !== after.llmContext.totalTokens.input) {
      changes.push({
        path: 'llmContext.totalTokens.input',
        oldValue: before.llmContext.totalTokens.input,
        newValue: after.llmContext.totalTokens.input,
      });
    }

    if (before.llmContext.totalTokens.output !== after.llmContext.totalTokens.output) {
      changes.push({
        path: 'llmContext.totalTokens.output',
        oldValue: before.llmContext.totalTokens.output,
        newValue: after.llmContext.totalTokens.output,
      });
    }

    return { changes };
  }

  /**
   * Compute diff for a single event by reconstructing before/after states.
   */
  async computeEventDiff(eventId: string): Promise<StateDiff> {
    const event = this.store.getEvent(eventId);
    if (!event || !event.goalId) {
      throw new Error(`Event ${eventId} not found or has no goalId`);
    }

    // Get state before event
    let beforeState = this.stateCache.get(event.timestamp - 1);
    if (!beforeState) {
      const result = await this.reconstructState(event.goalId, event.timestamp - 1);
      beforeState = result.state;
      this.stateCache.set(event.timestamp - 1, beforeState);
    }

    // Apply event to get after state
    const afterState = this.applyEvent(beforeState, event);
    this.stateCache.set(event.timestamp, afterState);

    return this.computeDiff(beforeState, afterState);
  }

  /**
   * Create an empty state for a goal.
   */
  private createEmptyState(goalId: string): SnapshotState {
    return {
      goal: {
        id: goalId,
        status: 'queued',
        data: {},
        updatedAt: Date.now(),
      },
      workItems: [],
      runs: [],
      metrics: {
        windowStart: Date.now(),
        windowEnd: Date.now(),
        data: {
          eventCounts: {},
          llmTokens: { input: 0, output: 0, total: 0 },
          toolInvocations: 0,
          goalStats: { created: 0, completed: 0, failed: 0 },
        },
      },
      llmContext: {
        activeRequests: [],
        totalTokens: { input: 0, output: 0 },
      },
    };
  }

  /**
   * Deep clone state to avoid mutations.
   */
  private cloneState(state: SnapshotState): SnapshotState {
    return {
      goal: { ...state.goal, data: { ...state.goal.data } },
      workItems: state.workItems.map((wi) => ({ ...wi, data: { ...wi.data } })),
      runs: state.runs.map((r) => ({ ...r, data: { ...r.data } })),
      metrics: {
        ...state.metrics,
        data: {
          ...state.metrics.data,
          eventCounts: { ...state.metrics.data.eventCounts },
          llmTokens: state.metrics.data.llmTokens
            ? { ...state.metrics.data.llmTokens }
            : undefined,
          goalStats: state.metrics.data.goalStats
            ? { ...state.metrics.data.goalStats }
            : undefined,
        },
      },
      llmContext: {
        activeRequests: state.llmContext.activeRequests.map((r) => ({ ...r })),
        totalTokens: { ...state.llmContext.totalTokens },
      },
    };
  }
}
