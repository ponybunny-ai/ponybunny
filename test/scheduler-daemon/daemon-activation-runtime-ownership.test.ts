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
});
