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
  const baseConfig = {
    $schema: 'https://ponybunny.dho.ai/schemas/agent.schema.json',
    schemaVersion: 1,
    id,
    name: `Agent ${id}`,
    description: 'Growth and pipeline agent',
    enabled: true,
    type: 'growth',
    subAgents: [],
    schedule: {
      enabled: true,
      everyMs: 60000,
      catchUp: { mode: 'coalesce' },
    },
    policy: {
      toolAllowlist: ['llm.classify'],
      forbiddenPatterns: [
        {
          pattern: '.pay',
          description: 'Disallow payment execution',
          severity: 'high',
        },
      ],
      prompts: {
        detect_system: 'Return ONLY valid JSON.',
      },
      limits: {
        lead_summary_max_chars: 1800,
      },
    },
    runner: {
      engine: 'default',
      config: {
        tick_defaults: {
          max_events_per_tick: 150,
          max_tasks_per_tick: 80,
          default_lookback_window: '24h',
        },
        circuit_breaker: {
          failure_threshold: 5,
          backoff_minutes: 20,
        },
      },
    },
  };
  fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify({ ...baseConfig, ...config }, null, 2));
  fs.writeFileSync(path.join(agentDir, 'AGENT.md'), `# ${id}\n`);
};

describe('cron job reconciliation', () => {
  it('reconciles enabled and disabled agents', async () => {
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-enabled', {
      name: 'Agent Enabled',
      schedule: { enabled: true, everyMs: 60000, catchUp: { mode: 'coalesce' } },
    });

    writeAgent(workspaceDir, 'agent-disabled', {
      name: 'Agent Disabled',
      enabled: false,
      schedule: { enabled: true, everyMs: 60000, catchUp: { mode: 'coalesce' } },
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
    expect(enabled?.schedule_interval_ms).toBe(60000);
    expect(enabled?.definition_hash).toBe(enabledDefinition?.definitionHash);
    expect(enabled?.next_run_at_ms).toEqual(expect.any(Number));

    expect(disabled).toBeDefined();
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.schedule_interval_ms).toBe(60000);
    expect(disabled?.definition_hash).toBe(disabledDefinition?.definitionHash);
    expect(disabled?.next_run_at_ms).toEqual(expect.any(Number));

    repository.close();
  });

  it('disables cron job when schedule toggle is off', async () => {
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-schedule-off', {
      name: 'Agent Schedule Off',
      schedule: { enabled: false, everyMs: 60000, catchUp: { mode: 'coalesce' } },
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    await reconcileCronJobsFromRegistry({ repository, registry });

    const job = repository.getCronJob('agent-schedule-off');
    expect(job).toBeDefined();
    expect(job?.enabled).toBe(false);

    repository.close();
  });

  it('disables cron jobs missing from registry', async () => {
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'agent-present', {
      name: 'Agent Present',
      schedule: { enabled: true, everyMs: 120000, catchUp: { mode: 'coalesce' } },
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

  it('reconciles only the selected main agent when provided', async () => {
    const workspaceDir = createTempDir();
    const dbPath = createTempDbPath();

    writeAgent(workspaceDir, 'lead', {
      name: 'Lead',
      schedule: { enabled: true, everyMs: 60000, catchUp: { mode: 'coalesce' } },
    });

    writeAgent(workspaceDir, 'scout', {
      name: 'Scout',
      schedule: { enabled: true, everyMs: 60000, catchUp: { mode: 'coalesce' } },
    });

    const registry = new AgentRegistry();
    await registry.loadAgents({ workspaceDir });

    const repository = new WorkOrderDatabase(dbPath);
    await repository.initialize();

    await reconcileCronJobsFromRegistry({ repository, registry, mainAgentId: 'lead' });

    const lead = repository.getCronJob('lead');
    const scout = repository.getCronJob('scout');

    expect(lead).toBeDefined();
    expect(lead?.enabled).toBe(true);
    expect(scout).toBeUndefined();

    repository.close();
  });
});
