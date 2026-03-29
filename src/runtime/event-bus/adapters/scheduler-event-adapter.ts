import { randomUUID } from 'crypto';
import type { ISchedulerCore } from '../../../scheduler/core/index.js';
import type { SchedulerEvent, SchedulerEventHandler, SchedulerEventType } from '../../../scheduler/types.js';
import type { EventBus as RuntimeEventBus } from '../event-bus.js';
import type { RuntimeEvent } from '../runtime-event.js';
import { runtimeEventBus } from '../runtime-event-bus.js';
import type { ILogger } from '../../../infra/observability/logger.js';
import { NoopLogger } from '../../../infra/observability/logger.js';

const SCHEDULER_EVENT_TYPE_MAP: Partial<Record<SchedulerEventType, string>> = {
  work_item_started: 'workitem.started',
  work_item_in_progress: 'workitem.in_progress',
  work_item_completed: 'workitem.completed',
  work_item_failed: 'workitem.failed',
  run_started: 'run.started',
  run_completed: 'run.completed',
  verification_started: 'verification.started',
  verification_completed: 'verification.completed',
  budget_warning: 'budget.warning',
  budget_exceeded: 'budget.exceeded',
};

export class SchedulerEventAdapter {
  private scheduler: ISchedulerCore | null = null;
  private handler: SchedulerEventHandler | null = null;
  private readonly logger: ILogger;

  constructor(private readonly bus: RuntimeEventBus = runtimeEventBus, logger: ILogger = new NoopLogger()) {
    this.logger = logger;
  }

  connect(scheduler: ISchedulerCore): void {
    if (this.scheduler) {
      this.logger.warn({ event: 'already_connected' }, 'Already connected to a scheduler');
      return;
    }

    this.scheduler = scheduler;
    this.handler = (event) => {
      this.handleSchedulerEvent(event);
    };

    scheduler.on(this.handler);
  }

  disconnect(): void {
    if (!this.scheduler || !this.handler) {
      return;
    }

    this.scheduler.off(this.handler);
    this.scheduler = null;
    this.handler = null;
  }

  private handleSchedulerEvent(event: SchedulerEvent): void {
    const runtimeType = SCHEDULER_EVENT_TYPE_MAP[event.type];
    if (!runtimeType) {
      return;
    }

    const runtimeEvent = this.toRuntimeEvent(runtimeType, event);
    void this.bus.publish(runtimeEvent).catch((error) => {
      this.logger.error({ event: 'publish_failed', eventType: runtimeType }, 'Failed to publish runtime event', error instanceof Error ? error : new Error(String(error)));
    });
  }

  private toRuntimeEvent(type: string, event: SchedulerEvent): RuntimeEvent {
    return {
      id: randomUUID(),
      type,
      source: 'scheduler',
      timestamp: event.timestamp,
      payload: event,
      ...(typeof event.goalId === 'string' && event.goalId.length > 0 ? { goalId: event.goalId } : {}),
      ...(typeof event.workItemId === 'string' && event.workItemId.length > 0
        ? { workItemId: event.workItemId }
        : {}),
      ...(typeof event.runId === 'string' && event.runId.length > 0 ? { runId: event.runId } : {}),
    };
  }
}
