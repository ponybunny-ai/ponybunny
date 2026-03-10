import { EventBus } from '../../../src/gateway/events/event-bus.js';
import { GatewaySchedulerEventAuditObserver } from '../../../src/gateway/runtime/gateway-scheduler-event-audit-observer.js';
import type { AuditService } from '../../../src/infra/audit/audit-service.js';

describe('GatewaySchedulerEventAuditObserver', () => {
  let eventBus: EventBus;
  let auditService: jest.Mocked<Pick<AuditService, 'logSchedulerEvent'>>;

  beforeEach(() => {
    eventBus = new EventBus();
    auditService = {
      logSchedulerEvent: jest.fn(),
    };
  });

  it('subscribes to scheduler-derived gateway events and forwards object payloads to audit logging', () => {
    const observer = new GatewaySchedulerEventAuditObserver({
      eventBus,
      auditService: auditService as unknown as AuditService,
    });

    observer.start();

    eventBus.emit('run.completed', {
      goalId: 'goal-1',
      workItemId: 'work-1',
      runId: 'run-1',
      success: true,
    });
    eventBus.emit('run.completed', 'ignored');

    expect(auditService.logSchedulerEvent).toHaveBeenCalledTimes(1);
    expect(auditService.logSchedulerEvent).toHaveBeenCalledWith('run.completed', {
      goalId: 'goal-1',
      workItemId: 'work-1',
      runId: 'run-1',
      success: true,
    });
  });

  it('stops forwarding events after teardown and does not double-register on repeated start', () => {
    const observer = new GatewaySchedulerEventAuditObserver({
      eventBus,
      auditService: auditService as unknown as AuditService,
    });

    observer.start();
    observer.start();
    eventBus.emit('goal.started', { goalId: 'goal-1' });
    observer.stop();
    eventBus.emit('goal.started', { goalId: 'goal-2' });

    expect(auditService.logSchedulerEvent).toHaveBeenCalledTimes(1);
    expect(auditService.logSchedulerEvent).toHaveBeenCalledWith('goal.started', { goalId: 'goal-1' });
  });
});
