/**
 * Timeline Service - Computes timeline metadata and manages caching.
 */

import type { IDebugDataStore } from '../store/types.js';
import type {
  TimelineMetadata,
  EnrichedEvent,
} from '../types.js';

export interface TimelineServiceOptions {
  enableCaching?: boolean;
}

const DEFAULT_OPTIONS: Required<TimelineServiceOptions> = {
  enableCaching: true,
};

/**
 * Computes and caches timeline metadata for goals.
 */
export class TimelineService {
  private store: IDebugDataStore;
  private options: Required<TimelineServiceOptions>;
  private metadataCache = new Map<string, TimelineMetadata>();

  constructor(store: IDebugDataStore, options: TimelineServiceOptions = {}) {
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get timeline metadata for a goal (with caching).
   */
  async getTimeline(goalId: string): Promise<TimelineMetadata> {
    // Check cache first
    if (this.options.enableCaching && this.metadataCache.has(goalId)) {
      const cached = this.metadataCache.get(goalId)!;

      // Invalidate if goal is still active
      const goal = this.store.getGoal(goalId);
      if (goal && (goal.status === 'completed' || goal.status === 'failed' || goal.status === 'cancelled')) {
        return cached; // Immutable, use cache
      }
    }

    // Check database cache
    const stored = this.store.getTimelineMetadata(goalId);
    if (stored) {
      this.metadataCache.set(goalId, stored);
      return stored;
    }

    // Compute fresh metadata
    const metadata = await this.computeTimelineMetadata(goalId);

    // Cache in memory and database
    if (this.options.enableCaching) {
      this.metadataCache.set(goalId, metadata);
      this.store.saveTimelineMetadata(metadata);
    }

    return metadata;
  }

  /**
   * Precompute timeline metadata for a completed goal.
   */
  async precomputeTimeline(goalId: string): Promise<void> {
    const metadata = await this.computeTimelineMetadata(goalId);
    this.store.saveTimelineMetadata(metadata);

    if (this.options.enableCaching) {
      this.metadataCache.set(goalId, metadata);
    }
  }

  /**
   * Compute timeline metadata from events.
   */
  private async computeTimelineMetadata(goalId: string): Promise<TimelineMetadata> {
    // Fetch all events for this goal
    const events = this.store.queryEvents({ goalId });

    if (events.length === 0) {
      const now = Date.now();
      return {
        goalId,
        totalEvents: 0,
        startTime: now,
        endTime: now,
        durationMs: 0,
        phaseBoundaries: [],
        errorMarkers: [],
        llmCallSpans: [],
        lastUpdated: now,
      };
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    const startTime = events[0].timestamp;
    const endTime = events[events.length - 1].timestamp;

    // Extract phase boundaries
    const phaseBoundaries = this.extractPhaseBoundaries(events);

    // Extract error markers
    const errorMarkers = events
      .filter((e) => e.type.includes('.error') || e.type.includes('.failed'))
      .map((e) => ({
        eventId: e.id,
        timestamp: e.timestamp,
      }));

    // Extract LLM call spans
    const llmCallSpans = this.extractLLMCallSpans(events);

    return {
      goalId,
      totalEvents: events.length,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      phaseBoundaries,
      errorMarkers,
      llmCallSpans,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Extract phase boundaries from events.
   */
  private extractPhaseBoundaries(
    events: EnrichedEvent[]
  ): Array<{ phase: string; startTime: number; endTime: number }> {
    const phases: Array<{ phase: string; startTime: number; endTime: number }> = [];
    let currentPhase: { phase: string; startTime: number } | null = null;

    for (const event of events) {
      // Detect phase transition events
      if (event.type === 'phase.transition' || event.type.startsWith('phase.')) {
        const phaseName = event.data.phase as string || event.data.to as string;

        if (phaseName) {
          // Close previous phase
          if (currentPhase) {
            phases.push({
              phase: currentPhase.phase,
              startTime: currentPhase.startTime,
              endTime: event.timestamp,
            });
          }

          // Start new phase
          currentPhase = {
            phase: phaseName,
            startTime: event.timestamp,
          };
        }
      }
    }

    // Close final phase
    if (currentPhase && events.length > 0) {
      phases.push({
        phase: currentPhase.phase,
        startTime: currentPhase.startTime,
        endTime: events[events.length - 1].timestamp,
      });
    }

    return phases;
  }

  /**
   * Extract LLM call spans from events.
   */
  private extractLLMCallSpans(
    events: EnrichedEvent[]
  ): Array<{ id: string; startTime: number; endTime: number; model: string; tokens: number }> {
    const spans: Array<{ id: string; startTime: number; endTime: number; model: string; tokens: number }> = [];
    const activeRequests = new Map<string, { startTime: number; model: string }>();

    for (const event of events) {
      if (event.type === 'llm.request') {
        const requestId = event.data.requestId as string;
        const model = event.data.model as string;
        if (requestId && model) {
          activeRequests.set(requestId, {
            startTime: event.timestamp,
            model,
          });
        }
      } else if (event.type === 'llm.response' || event.type === 'llm.error') {
        const requestId = event.data.requestId as string;
        if (requestId && activeRequests.has(requestId)) {
          const request = activeRequests.get(requestId)!;
          const tokens = (event.data.inputTokens as number || 0) + (event.data.outputTokens as number || 0);

          spans.push({
            id: requestId,
            startTime: request.startTime,
            endTime: event.timestamp,
            model: request.model,
            tokens,
          });

          activeRequests.delete(requestId);
        }
      }
    }

    return spans;
  }

  /**
   * Invalidate cache for a goal.
   */
  invalidateCache(goalId: string): void {
    this.metadataCache.delete(goalId);
  }

  /**
   * Clear all cached metadata.
   */
  clearCache(): void {
    this.metadataCache.clear();
  }
}
