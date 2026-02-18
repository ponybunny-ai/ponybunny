import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentRegistry } from '../../../src/infra/agents/agent-registry.js';
import { reconcileCronJobsFromRegistry } from '../../../src/infra/scheduler/cron-job-reconciler.js';
import { WorkOrderDatabase } from '../../../src/infra/persistence/work-order-repository.js';

const createTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'pony-agents-'));

const createTempDbPath = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pony-cron-reconcile-'));
  return path.join(dir, 'cron.db');
};

const writeAgent = (
  workspaceDir: string,
  id: string,
  config: Record<string, unknown>
): void => {
  const agentDir = path.join(workspaceDir, 'agents', id);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), `# ${id}\n`);
};

describe('cron job reconciliation', () => {
  it('reconciles enabled and disabled agents', async () => {
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-enabled', {
      schemaVersion: 1,
      id: 'agent-enabled',
      name: 'Agent Enabled',
      enabled: true,
      type: 'test',
      schedule: { cron: '0 * * * *' },
      policy: {},
      runner: {},
    });

    writeAgent(workspaceDir, 'agent-disabled', {
      schemaVersion: 1,
      id: 'agent-disabled',
      name: 'Agent Disabled',
      enabled: false,
      type: 'test',
      schedule: { everyMs: 60000 },
      policy: {},
      runner: {},
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    await reconcileCronJobsFromRegistry({ repository, registry });

    const enabled = repository.getCronJob('agent-enabled');
    const disabled = repository.getCronJob('agent-disabled');
    const enabledDefinition = registry.getAgent('agent-enabled');
    const disabledDefinition = registry.getAgent('agent-disabled');

    expect(enabled).toBeDefined();
    expect(enabled?.enabled).toBe(true);
    expect(enabled?.schedule_cron).toBe('0 * * * *');
    expect(enabled?.definition_hash).toBe(enabledDefinition?.definitionHash);

    expect(disabled).toBeDefined();
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.schedule_interval_ms).toBe(60000);
    expect(disabled?.definition_hash).toBe(disabledDefinition?.definitionHash);

    repository.close();
  });

  it('disables cron jobs missing from registry', async () => {
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-present', {
      schemaVersion: 1,
      id: 'agent-present',
      name: 'Agent Present',
      enabled: true,
      type: 'test',
      schedule: { everyMs: 120000 },
      policy: {},
      runner: {},
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    repository.upsertCronJob({
      agent_id: 'agent-missing',
      enabled: true,
      schedule: { kind: 'interval', every_ms: 30000 },
      definition_hash: 'missing-hash',
    });

    await reconcileCronJobsFromRegistry({ repository, registry });

    const missing = repository.getCronJob('agent-missing');
    expect(missing).toBeDefined();
    expect(missing?.enabled).toBe(false);

    repository.close();
  });
});
