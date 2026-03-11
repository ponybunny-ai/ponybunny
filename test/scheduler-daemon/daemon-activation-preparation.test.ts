import { jest } from '@jest/globals';

import type { AgentDefinition } from '../../src/infra/agents/agent-registry.js';
import type { IWorkOrderRepository } from '../../src/infra/persistence/repository-interface.js';
import {
  prepareDaemonActivation,
  resolveDaemonMainAgentId,
} from '../../src/scheduler-daemon/daemon-activation-preparation.js';

const createAgentDefinition = (
  id: string,
  overrides: {
    enabled?: boolean;
    scheduleEnabled?: boolean;
    everyMs?: number;
    definitionHash?: string;
  } = {}
): AgentDefinition =>
  ({
    id,
    source: 'workspace',
    status: 'valid',
    markdown: `# ${id}\n`,
    definitionHash: overrides.definitionHash ?? `${id}-hash`,
    configPath: `/tmp/${id}/agent.json`,
    markdownPath: `/tmp/${id}/AGENT.md`,
    config: {
      enabled: overrides.enabled ?? true,
      schedule: {
        enabled: overrides.scheduleEnabled ?? true,
        kind: 'interval',
        everyMs: overrides.everyMs ?? 60000,
      },
    },
  }) as AgentDefinition;

const createCronRepository = (
  actions: string[] = []
): Pick<IWorkOrderRepository, 'upsertCronJob' | 'listCronJobs'> => {
  const upsertCronJob = jest.fn<IWorkOrderRepository['upsertCronJob']>((job) => {
      actions.push(`upsert:${job.agent_id}:${job.enabled}`);
      return {
        agent_id: job.agent_id,
        enabled: job.enabled,
        schedule_cron: job.schedule.kind === 'cron' ? job.schedule.cron : undefined,
        schedule_timezone: job.schedule.tz,
        schedule_interval_ms:
          job.schedule.kind === 'interval' ? job.schedule.every_ms : undefined,
        definition_hash: job.definition_hash,
        failure_count: 0,
      };
    });
  const listCronJobs = jest.fn<IWorkOrderRepository['listCronJobs']>(() => {
      actions.push('listCronJobs');
      return [];
    });

  return {
    upsertCronJob,
    listCronJobs,
  };
};

describe('prepareDaemonActivation', () => {
  it('loads agents before reconciling cron jobs and scopes reconciliation to the selected main agent', async () => {
    const actions: string[] = [];
    const lead = createAgentDefinition('lead');
    const scout = createAgentDefinition('scout');
    let loaded = false;
    const registry = {
      loadAgents: jest.fn(async ({ workspaceDir }: { workspaceDir: string }) => {
        actions.push(`load:${workspaceDir}`);
        loaded = true;
      }),
      getAgents: jest.fn(() => {
        actions.push('getAgents');
        return loaded ? [lead, scout] : [];
      }),
    };
    const repository = createCronRepository(actions);

    const result = await prepareDaemonActivation({
      repository: repository as unknown as IWorkOrderRepository,
      registry: registry as never,
      configuredMainAgentId: 'scout',
      workspaceDir: '/tmp/workspace',
    });

    expect(registry.loadAgents).toHaveBeenCalledWith({ workspaceDir: '/tmp/workspace' });
    expect(result).toEqual({
      availableAgentIds: ['lead', 'scout'],
      mainAgentId: 'scout',
      cronJobReconcileSummary: {
        upserted: 1,
        disabled: 0,
        skipped: 0,
      },
    });
    expect(actions).toEqual([
      'load:/tmp/workspace',
      'getAgents',
      'getAgents',
      'upsert:scout:true',
      'listCronJobs',
    ]);
  });

  it('falls back to lead when the configured main agent is unavailable', async () => {
    const lead = createAgentDefinition('lead');
    const analyst = createAgentDefinition('analyst');
    const registry = {
      loadAgents: jest.fn(async () => undefined),
      getAgents: jest.fn(() => [lead, analyst]),
    };
    const repository = createCronRepository();

    const result = await prepareDaemonActivation({
      repository: repository as unknown as IWorkOrderRepository,
      registry: registry as never,
      configuredMainAgentId: 'missing',
      workspaceDir: '/tmp/workspace',
    });

    expect(result.mainAgentId).toBe('lead');
    expect(repository.upsertCronJob).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'lead',
        enabled: true,
        definition_hash: 'lead-hash',
      })
    );
    expect(repository.upsertCronJob).not.toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'analyst',
      })
    );
  });

  it('returns a null main agent when no agents are available', async () => {
    const registry = {
      loadAgents: jest.fn(async () => undefined),
      getAgents: jest.fn(() => []),
    };
    const repository = createCronRepository();

    const result = await prepareDaemonActivation({
      repository: repository as unknown as IWorkOrderRepository,
      registry: registry as never,
      workspaceDir: '/tmp/workspace',
    });

    expect(result).toEqual({
      availableAgentIds: [],
      mainAgentId: null,
      cronJobReconcileSummary: {
        upserted: 0,
        disabled: 0,
        skipped: 0,
      },
    });
  });
});

describe('resolveDaemonMainAgentId', () => {
  it('prefers the configured id, then lead, then the first available id', () => {
    expect(resolveDaemonMainAgentId('analyst', ['lead', 'analyst'])).toBe('analyst');
    expect(resolveDaemonMainAgentId('missing', ['lead', 'analyst'])).toBe('lead');
    expect(resolveDaemonMainAgentId(undefined, ['analyst', 'scout'])).toBe('analyst');
    expect(resolveDaemonMainAgentId(undefined, [])).toBeNull();
  });
});
