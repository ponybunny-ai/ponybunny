import { readFileSync } from 'fs';
import path from 'path';

describe('GatewayServer scheduler-audit/runtime ownership split', () => {
  test('GatewayServer delegates scheduler-event audit observation wiring to the runtime helper', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/gateway/gateway-server.ts'), 'utf8');

    expect(source).toContain("from './runtime/gateway-scheduler-event-audit-observer.js'");
    expect(source).toContain('this.schedulerEventAuditObserver = new GatewaySchedulerEventAuditObserver(');
    expect(source).toContain('setupSchedulerEventAudit: () => this.schedulerEventAuditObserver.start()');
    expect(source).toContain('teardownSchedulerEventAudit: () => this.schedulerEventAuditObserver.stop()');
    expect(source).not.toContain('private schedulerEventAuditUnsubscribers: Array<() => void> = [];');
    expect(source).not.toContain('private setupSchedulerEventAudit(): void {');
    expect(source).not.toContain('private teardownSchedulerEventAudit(): void {');
  });
});
