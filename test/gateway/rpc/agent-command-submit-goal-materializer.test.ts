import type { PonyBunnyRuntimeConfig } from '../../../src/infra/config/runtime-config.js';
import type { AgentDefinition } from '../../../src/infra/agents/agent-registry.js';
import {
  RegistryBackedAgentCommandSubmitGoalMaterializer,
  type IRemoteGoalMaterializationClient,
} from '../../../src/gateway/rpc/agent-command-submit-goal-materializer.js';

describe('RegistryBackedAgentCommandSubmitGoalMaterializer', () => {
  const runtimeConfig = {
    agent: {
      mainAgentId: 'lead',
    },
  } as PonyBunnyRuntimeConfig;

  const buildDefinition = (overrides?: {
    enabled?: boolean;
    toolAllowlist?: string[];
    toolDenylist?: string[];
    forbiddenPatterns?: Array<{ pattern: string }>;
  }): AgentDefinition => ({
    id: 'lead',
    source: 'workspace',
    definitionHash: 'hash-lead',
    markdown: '# Lead',
    status: 'valid',
    configPath: '/tmp/agents/lead/agent.json',
    markdownPath: '/tmp/agents/lead/AGENT.md',
    config: {
      schemaVersion: 1,
      id: 'lead',
      name: 'Lead',
      enabled: overrides?.enabled ?? true,
      type: 'react',
      workdir: './workdir',
      schedule: {
        enabled: false,
        kind: 'interval',
        everyMs: 60_000,
        jitterMs: undefined,
        tz: undefined,
        windows: undefined,
        catchUp: {
          mode: 'coalesce',
        },
      },
      policy: {
        toolAllowlist: overrides?.toolAllowlist ?? ['read_file', 'search_code', 'execute_command'],
        toolDenylist: overrides?.toolDenylist ?? ['execute_command'],
        forbiddenPatterns: overrides?.forbiddenPatterns ?? [{ pattern: 'search' }],
        approval: {
          required: true,
          actions: ['execute_command'],
        },
      },
      runner: {
        config: {},
      },
    },
  });

  it('owns the registry-backed definition load and scheduler materialization for agent.command.submit', async () => {
    const loadAgents = jest.fn(async () => {});
    const getAgent = jest.fn(() => buildDefinition());
    const ensureAgentWorkdir = jest.fn(() => '/tmp/pony-workdir/lead');
    const materializeGoal = jest.fn(async () => ({
      goal: { id: 'goal-1' } as any,
      initialWorkItemId: 'wi-1',
    }));
    const remoteSchedulerClient: IRemoteGoalMaterializationClient = {
      isSchedulerDaemonConnected: jest.fn(() => true),
      materializeGoal,
    };

    const materializer = new RegistryBackedAgentCommandSubmitGoalMaterializer(
      { loadAgents, getAgent },
      {
        loadRuntimeConfig: () => runtimeConfig,
        ensureAgentWorkdir,
        createRunKey: () => 'run-123',
        getNow: () => 1_700_000_000_000,
        getWorkspaceDir: () => '/tmp/workspace',
      }
    );

    const result = await materializer.materializeAgentCommandGoal({
      command: '  summarize pipeline status  ',
      session: {
        publicKey: 'pk-test',
        permissions: ['read', 'write'],
      },
      remoteSchedulerClient,
    });

    expect(result).toEqual({
      goal: { id: 'goal-1' },
      initialWorkItemId: 'wi-1',
    });
    expect(loadAgents).toHaveBeenCalledWith({ workspaceDir: '/tmp/workspace' });
    expect(getAgent).toHaveBeenCalledWith('lead');
    expect(ensureAgentWorkdir).toHaveBeenCalledWith({
      agentId: 'lead',
      configuredWorkdir: './workdir',
      configPath: '/tmp/agents/lead/agent.json',
    });
    expect(materializeGoal).toHaveBeenCalledWith({
      goalSpec: {
        title: 'Agent Command: Lead',
        description: 'summarize pipeline status',
        success_criteria: [
          {
            description: 'Agent command completes successfully',
            type: 'deterministic',
            verification_method: 'status_check',
            required: true,
          },
        ],
        priority: 50,
      },
      initialWorkItemSpec: {
        title: 'Run Lead',
        description: 'summarize pipeline status',
        item_type: 'analysis',
        priority: 50,
        dependencies: [],
        context: {
          kind: 'agent_tick',
          agent_id: 'lead',
          definition_hash: 'hash-lead',
          run_key: 'run-123',
          scheduled_for_ms: 1_700_000_000_000,
          agent_workdir: '/tmp/pony-workdir/lead',
          tool_allowlist: ['read_file'],
          approval_required: true,
          approval_actions: ['execute_command'],
          tool_policy_context: {
            agentId: 'lead',
            isSubagent: false,
            sandboxed: false,
            isOwner: true,
          },
          policy_snapshot: {
            toolAllowlist: ['read_file', 'search_code', 'execute_command'],
            toolDenylist: ['execute_command'],
            forbiddenPatterns: [{ pattern: 'search' }],
            approval: {
              required: true,
              actions: ['execute_command'],
            },
          },
          routeContext: {
            source: 'gateway.message',
            providerId: undefined,
            channel: 'rpc',
            agentId: 'lead',
            runKey: 'run-123',
            senderId: 'pk-test',
            matchedBy: 'user_command',
            senderIsOwner: false,
            sandboxed: false,
            isSubagent: false,
          },
        },
      },
      autoSubmitGoal: true,
    });
  });

  it('rejects disabled default agents before scheduler handoff', async () => {
    const loadAgents = jest.fn(async () => {});
    const getAgent = jest.fn(() => buildDefinition({ enabled: false }));
    const materializer = new RegistryBackedAgentCommandSubmitGoalMaterializer(
      { loadAgents, getAgent },
      {
        loadRuntimeConfig: () => runtimeConfig,
      }
    );

    await expect(
      materializer.materializeAgentCommandGoal({
        command: 'summarize pipeline status',
        session: {
          publicKey: 'pk-test',
          permissions: ['read'],
        },
      })
    ).rejects.toThrow('agent not found or disabled: lead');

    expect(loadAgents).toHaveBeenCalledWith({ workspaceDir: process.cwd() });
    expect(getAgent).toHaveBeenCalledWith('lead');
  });

  it('preserves the current daemon-required check before workdir creation', async () => {
    const loadAgents = jest.fn(async () => {});
    const getAgent = jest.fn(() => buildDefinition());
    const ensureAgentWorkdir = jest.fn(() => '/tmp/pony-workdir/lead');
    const materializer = new RegistryBackedAgentCommandSubmitGoalMaterializer(
      { loadAgents, getAgent },
      {
        loadRuntimeConfig: () => runtimeConfig,
        ensureAgentWorkdir,
        createRunKey: () => 'run-123',
        getNow: () => 1_700_000_000_000,
      }
    );

    await expect(
      materializer.materializeAgentCommandGoal({
        command: 'summarize pipeline status',
        session: {
          publicKey: 'pk-test',
          permissions: ['read'],
        },
      })
    ).rejects.toThrow('scheduler daemon is required for agent.command.submit');

    expect(ensureAgentWorkdir).not.toHaveBeenCalled();
  });
});
