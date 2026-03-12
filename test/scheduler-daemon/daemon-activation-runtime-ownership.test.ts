import { readFileSync } from 'fs';
import path from 'path';

describe('SchedulerDaemon activation preparation ownership split', () => {
  test('SchedulerDaemon delegates daemon-owned activation preparation to the helper boundary', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/scheduler-daemon/daemon.ts'), 'utf8');

    expect(source).toContain("from './daemon-activation-preparation.js'");
    expect(source).toContain('prepareDaemonActivation({');
    expect(source).not.toContain("await registry.loadAgents({ workspaceDir: process.cwd() });");
    expect(source).not.toContain('function resolveMainAgentId(');
    expect(source).not.toContain('reconcileCronJobsFromRegistry({');
  });

  test('SchedulerDaemon delegates runner registration and recurring enablement to the later-startup boundary', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/scheduler-daemon/daemon.ts'), 'utf8');

    expect(source).toContain("from './daemon-recurring-startup.js'");
    expect(source).toContain('const recurringStartup = startDaemonRecurringStartup({');
    expect(source).not.toContain("runnerRegistry.register('default', schemaRunner);");
    expect(source).not.toContain("runnerRegistry.register('market_listener', schemaRunner);");
    expect(source).not.toContain('new AgentScheduler(');
    expect(source).not.toContain('this.agentSchedulerInterval = setInterval(() => {');

    const activationIndex = source.indexOf('const activationPreparation = await prepareDaemonActivation({');
    const recoveryIndex = source.indexOf('await this.recoverQueuedGoals();');
    const recurringStartupIndex = source.indexOf('const recurringStartup = startDaemonRecurringStartup({');
    const retentionIndex = source.indexOf('this.startRunEventRetentionLoop();');

    expect(activationIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(activationIndex);
    expect(recurringStartupIndex).toBeGreaterThan(recoveryIndex);
    expect(retentionIndex).toBeGreaterThan(recurringStartupIndex);
  });
});
