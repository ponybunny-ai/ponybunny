import type { AuditService } from '../../infra/audit/audit-service.js';
import type { EventBus } from '../events/event-bus.js';

const SCHEDULER_AUDIT_EVENTS = [
  'goal.started',
  'goal.completed',
  'goal.failed',
  'workitem.started',
  'workitem.in_progress',
  'workitem.ended',
  'workitem.completed',
  'workitem.failed',
  'run.started',
  'run.completed',
  'verification.started',
  'verification.completed',
  'escalation.created',
  'escalation.resolved',
  'budget.warning',
  'budget.exceeded',
] as const;

export interface GatewaySchedulerEventAuditObserverDependencies {
  eventBus: EventBus;
  auditService: AuditService;
}

export class GatewaySchedulerEventAuditObserver {
  private readonly eventBus: EventBus;
  private readonly auditService: AuditService;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(dependencies: GatewaySchedulerEventAuditObserverDependencies) {
    this.eventBus = dependencies.eventBus;
    this.auditService = dependencies.auditService;
  }

  start(): void {
    if (this.unsubscribers.length > 0) {
      return;
    }

    for (const event of SCHEDULER_AUDIT_EVENTS) {
      const unsubscribe = this.eventBus.on(event, (sample: unknown) => {
        if (sample && typeof sample === 'object') {
          this.auditService.logSchedulerEvent(event, sample as Record<string, unknown>);
        }
      });
      this.unsubscribers.push(unsubscribe);
    }
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
  }
}
