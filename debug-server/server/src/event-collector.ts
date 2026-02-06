/**
 * Event Collector - Processes, enriches, and stores debug events.
 */

import { EventEmitter } from 'events';
import type { IDebugDataStore } from './store/types.js';
import type { DebugEvent, EnrichedEvent, AggregatedMetrics, CachedGoal, CachedWorkItem, CachedRun } from './types.js';
import { debugEventFactory } from './events/factory.js';

export interface EventCollectorOptions {
  metricsWindowMs?: number;
}

const DEFAULT_OPTIONS: Required<EventCollectorOptions> = {
  metricsWindowMs: 300000, // 5 minutes
};

/**
 * Collects, processes, and stores debug events.
 * Emits 'event' for real-time streaming to WebSocket clients.
 */
export class EventCollector extends EventEmitter {
  private store: IDebugDataStore;
  private options: Required<EventCollectorOptions>;

  // Metrics aggregation
  private currentWindowStart: number = 0;
  private eventCounts: Record<string, number> = {};
  private llmTokens = { input: 0, output: 0 };
  private toolInvocations = 0;
  private goalStats = { created: 0, completed: 0, failed: 0 };

  constructor(store: IDebugDataStore, options: EventCollectorOptions = {}) {
    super();
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.resetMetricsWindow();
  }

  /**
   * Ingest a raw debug event.
   */
  ingest(event: DebugEvent): void {
    // Process event through factory
    const enrichedEvent = debugEventFactory.process(event);

    // Store event
    this.store.saveEvent(enrichedEvent);

    // Update entity caches based on event type
    this.updateEntityCache(enrichedEvent);

    // Update metrics
    this.updateMetrics(enrichedEvent);

    // Emit for real-time streaming
    this.emit('event', enrichedEvent);
  }

  /**
   * Get current aggregated metrics.
   */
  computeMetrics(): AggregatedMetrics {
    const now = Date.now();
    return {
      windowStart: this.currentWindowStart,
      windowEnd: now,
      data: {
        eventCounts: { ...this.eventCounts },
        llmTokens: {
          input: this.llmTokens.input,
          output: this.llmTokens.output,
          total: this.llmTokens.input + this.llmTokens.output,
        },
        toolInvocations: this.toolInvocations,
        goalStats: { ...this.goalStats },
      },
    };
  }

  /**
   * Flush current metrics to storage and start new window.
   */
  flushMetrics(): void {
    const metrics = this.computeMetrics();
    this.store.saveMetrics(metrics);
    this.resetMetricsWindow();
  }

  private updateEntityCache(event: EnrichedEvent): void {
    const now = Date.now();

    switch (event.type) {
      case 'goal.created': {
        const goal = event.data.goal as Record<string, unknown> | undefined;
        if (goal && typeof goal.id === 'string') {
          const cachedGoal: CachedGoal = {
            id: goal.id,
            status: (goal.status as string) || 'queued',
            title: goal.title as string | undefined,
            data: goal,
            updatedAt: now,
          };
          this.store.upsertGoal(cachedGoal);
        }
        break;
      }

      case 'goal.status_changed': {
        const goalId = event.goalId || (event.data.goalId as string);
        const newStatus = event.data.to as string;
        if (goalId && newStatus) {
          const existing = this.store.getGoal(goalId);
          if (existing) {
            existing.status = newStatus;
            existing.updatedAt = now;
            this.store.upsertGoal(existing);
          }
        }
        break;
      }

      case 'workitem.created': {
        const workItem = event.data.workItem as Record<string, unknown> | undefined;
        if (workItem && typeof workItem.id === 'string') {
          const cachedWorkItem: CachedWorkItem = {
            id: workItem.id,
            goalId: (workItem.goal_id as string) || event.goalId || '',
            status: (workItem.status as string) || 'queued',
            title: workItem.title as string | undefined,
            data: workItem,
            updatedAt: now,
          };
          this.store.upsertWorkItem(cachedWorkItem);
        }
        break;
      }

      case 'workitem.status_changed': {
        const workItemId = event.workItemId || (event.data.workItemId as string);
        const newStatus = event.data.to as string;
        if (workItemId && newStatus) {
          const items = this.store.getWorkItems();
          const existing = items.find((w) => w.id === workItemId);
          if (existing) {
            existing.status = newStatus;
            existing.updatedAt = now;
            this.store.upsertWorkItem(existing);
          }
        }
        break;
      }

      case 'run.started': {
        const run = event.data.run as Record<string, unknown> | undefined;
        if (run && typeof run.id === 'string') {
          const cachedRun: CachedRun = {
            id: run.id,
            workItemId: (run.work_item_id as string) || event.workItemId || '',
            status: 'running',
            data: run,
            updatedAt: now,
          };
          this.store.upsertRun(cachedRun);
        }
        break;
      }

      case 'run.completed':
      case 'run.failed': {
        const runId = event.runId || (event.data.runId as string);
        const newStatus = event.type === 'run.completed' ? 'completed' : 'failed';
        if (runId) {
          const runs = this.store.getRuns();
          const existing = runs.find((r) => r.id === runId);
          if (existing) {
            existing.status = newStatus;
            existing.updatedAt = now;
            this.store.upsertRun(existing);
          }
        }
        break;
      }
    }
  }

  private updateMetrics(event: EnrichedEvent): void {
    // Check if we need to start a new window
    const now = Date.now();
    if (now - this.currentWindowStart >= this.options.metricsWindowMs) {
      this.flushMetrics();
    }

    // Count events by type
    const typePrefix = event.type.split('.')[0];
    this.eventCounts[typePrefix] = (this.eventCounts[typePrefix] || 0) + 1;
    this.eventCounts[event.type] = (this.eventCounts[event.type] || 0) + 1;

    // Track LLM tokens
    if (event.type === 'llm.tokens') {
      this.llmTokens.input += (event.data.inputTokens as number) || 0;
      this.llmTokens.output += (event.data.outputTokens as number) || 0;
    }

    // Track tool invocations
    if (event.type === 'tool.invoke') {
      this.toolInvocations++;
    }

    // Track goal stats
    if (event.type === 'goal.created') {
      this.goalStats.created++;
    } else if (event.type === 'goal.completed') {
      this.goalStats.completed++;
    } else if (event.type === 'goal.status_changed' && event.data.to === 'cancelled') {
      this.goalStats.failed++;
    }
  }

  private resetMetricsWindow(): void {
    this.currentWindowStart = Date.now();
    this.eventCounts = {};
    this.llmTokens = { input: 0, output: 0 };
    this.toolInvocations = 0;
    this.goalStats = { created: 0, completed: 0, failed: 0 };
  }
}
