import { randomUUID } from 'crypto';
import type { EventBus as GatewayEventBus } from '../../../gateway/events/event-bus.js';
import type { EventBus as RuntimeEventBus } from '../event-bus.js';
import type { RuntimeEvent } from '../runtime-event.js';
import { runtimeEventBus } from '../runtime-event-bus.js';
import type { ILogger } from '../../../infra/observability/logger.js';
import { NoopLogger } from '../../../infra/observability/logger.js';

const FORWARDED_GATEWAY_EVENTS = [
  'goal.created',
  'goal.started',
  'goal.completed',
  'goal.failed',
  'workitem.started',
  'workitem.completed',
  'workitem.failed',
  'run.started',
  'run.completed',
] as const;

type ForwardedGatewayEvent = (typeof FORWARDED_GATEWAY_EVENTS)[number];

export class GatewayEventAdapter {
  private readonly unsubscribers: Array<() => void> = [];
  private started = false;
  private readonly logger: ILogger;

  constructor(
    private readonly gatewayEventBus: GatewayEventBus,
    private readonly bus: RuntimeEventBus = runtimeEventBus,
    logger: ILogger = new NoopLogger()
  ) {
    this.logger = logger;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    for (const eventType of FORWARDED_GATEWAY_EVENTS) {
      const unsubscribe = this.gatewayEventBus.on(eventType, (payload: unknown) => {
        const runtimeEvent = this.toRuntimeEvent(eventType, payload);
        void this.bus.publish(runtimeEvent).catch((error) => {
          this.logger.error({ event: 'publish_failed', eventType }, 'Failed to publish runtime event', error instanceof Error ? error : new Error(String(error)));
        });
      });
      this.unsubscribers.push(unsubscribe);
    }
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    while (this.unsubscribers.length > 0) {
      const unsubscribe = this.unsubscribers.pop();
      unsubscribe?.();
    }
  }

  private toRuntimeEvent(type: ForwardedGatewayEvent, payload: unknown): RuntimeEvent {
    const normalizedPayload = this.normalizePayload(payload);
    const metadata = this.extractIdentifiers(normalizedPayload);

    return {
      id: randomUUID(),
      type,
      source: 'gateway',
      timestamp: Date.now(),
      payload: normalizedPayload,
      ...metadata,
    };
  }

  private extractIdentifiers(payload: unknown): Pick<RuntimeEvent, 'goalId' | 'workItemId' | 'runId'> {
    if (!payload || typeof payload !== 'object') {
      return {};
    }

    const sample = payload as Record<string, unknown>;
    const goalId = this.readString(sample.goalId);
    const workItemId = this.readString(sample.workItemId) ?? this.readString(sample.taskId);
    const runId = this.readString(sample.runId);

    return {
      ...(goalId ? { goalId } : {}),
      ...(workItemId ? { workItemId } : {}),
      ...(runId ? { runId } : {}),
    };
  }

  private normalizePayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return payload;
    }

    const sample = payload as Record<string, unknown>;
    const workItemId = this.readString(sample.workItemId) ?? this.readString(sample.taskId);
    if (!workItemId) {
      return payload;
    }

    const { taskId: _taskId, ...rest } = sample;

    return { ...rest, workItemId };
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
