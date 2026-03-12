import {
  RegistryBackedSubagentExecutionBoundary,
  type SubagentExecutionBoundary,
} from '../../../src/infra/agents/subagent-execution-boundary.js';

const ensureAgentWorkdirMock = jest.fn();

jest.mock('../../../src/infra/agents/agent-workdir.js', () => ({
  ensureAgentWorkdir: (...args: unknown[]) => ensureAgentWorkdirMock(...args),
}));

describe('RegistryBackedSubagentExecutionBoundary', () => {
  beforeEach(() => {
    ensureAgentWorkdirMock.mockReset();
  });

  it('loads and maps agent capabilities when requested', async () => {
    let loaded = false;
    const agents = [
      {
        id: 'lead',
        source: 'workspace',
        status: 'valid',
        configPath: '/tmp/lead/agent.json',
        config: {
          name: 'Lead',
          type: 'growth',
          enabled: true,
          workdir: './lead-workdir',
          schedule: { kind: 'interval' },
        },
      },
    ];

    const registry = {
      getAgent: jest.fn(),
      getAgents: jest.fn(() => (loaded ? agents : [])),
      loadAgents: jest.fn(async () => {
        loaded = true;
      }),
    };

    const boundary = new RegistryBackedSubagentExecutionBoundary(
      registry as never,
      {
        startSubagents: jest.fn(),
        stopSubagents: jest.fn(),
        getHeartbeatSnapshot: jest.fn(() => []),
      },
      { warn: jest.fn() },
      () => '/tmp/workspace'
    );

    const capabilities = await boundary.listAgentCapabilities({ ensureLoaded: true });

    expect(registry.loadAgents).toHaveBeenCalledWith({ workspaceDir: '/tmp/workspace' });
    expect(capabilities).toEqual([
      {
        id: 'lead',
        name: 'Lead',
        type: 'growth',
        enabled: true,
        source: 'workspace',
        status: 'valid',
        scheduleKind: 'interval',
        configPath: '/tmp/lead/agent.json',
        configuredWorkdir: './lead-workdir',
      },
    ]);
  });

  it('owns spawn-target qualification and delegates only runnable targets to the process manager', async () => {
    ensureAgentWorkdirMock.mockImplementation(({ agentId }: { agentId: string }) => `/tmp/${agentId}`);
    const child = {} as never;

    const processManager = {
      startSubagents: jest.fn(async () => [
        {
          subagentId: 'scout',
          pid: 9911,
          child,
        },
      ]),
      stopSubagents: jest.fn(async () => undefined),
      getHeartbeatSnapshot: jest.fn(() => [
        {
          subagentId: 'scout',
          pid: 9911,
          lastHeartbeatAtMs: 42,
          stale: false,
        },
      ]),
    };
    const logger = { warn: jest.fn() };
    const registry = {
      getAgent: jest.fn((agentId: string) => {
        if (agentId === 'scout') {
          return {
            id: 'scout',
            source: 'workspace',
            status: 'valid',
            configPath: '/tmp/scout/agent.json',
            config: {
              name: 'Scout',
              type: 'growth',
              enabled: true,
              workdir: './scout',
              schedule: { kind: 'interval' },
            },
          };
        }
        if (agentId === 'disabled') {
          return {
            id: 'disabled',
            source: 'workspace',
            status: 'valid',
            configPath: '/tmp/disabled/agent.json',
            config: {
              name: 'Disabled',
              type: 'growth',
              enabled: false,
              workdir: './disabled',
              schedule: { kind: 'interval' },
            },
          };
        }
        return undefined;
      }),
      getAgents: jest.fn(() => []),
    };

    const boundary: SubagentExecutionBoundary = new RegistryBackedSubagentExecutionBoundary(
      registry as never,
      processManager,
      logger
    );

    const scope = await boundary.startExecution({
      agentId: 'lead',
      runKey: 'run-1',
      goalId: 'goal-1',
      isSubagent: false,
      subAgents: ['scout', 'disabled', 'missing'],
    });

    expect(ensureAgentWorkdirMock).toHaveBeenCalledWith({
      agentId: 'scout',
      configuredWorkdir: './scout',
      configPath: '/tmp/scout/agent.json',
    });
    expect(processManager.startSubagents).toHaveBeenCalledWith({
      agentId: 'lead',
      runKey: 'run-1',
      goalId: 'goal-1',
      targets: [
        {
          subagentId: 'scout',
          workdir: '/tmp/scout',
        },
      ],
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(scope.getRuntimeContext()).toEqual({
      subagentProcesses: [
        {
          subagentId: 'scout',
          pid: 9911,
        },
      ],
      subagentHeartbeats: [
        {
          subagentId: 'scout',
          pid: 9911,
          lastHeartbeatAtMs: 42,
          stale: false,
        },
      ],
    });

    await scope.stop();
    expect(processManager.stopSubagents).toHaveBeenCalledWith([
      {
        subagentId: 'scout',
        pid: 9911,
        child,
      },
    ]);
  });

  it('returns an inactive scope for subagent ticks without touching the process manager', async () => {
    const processManager = {
      startSubagents: jest.fn(),
      stopSubagents: jest.fn(),
      getHeartbeatSnapshot: jest.fn(() => []),
    };
    const boundary = new RegistryBackedSubagentExecutionBoundary(
      {
        getAgent: jest.fn(),
        getAgents: jest.fn(() => []),
      } as never,
      processManager,
      { warn: jest.fn() }
    );

    const scope = await boundary.startExecution({
      agentId: 'scout',
      runKey: 'run-2',
      isSubagent: true,
      subAgents: ['child-a'],
    });

    expect(processManager.startSubagents).not.toHaveBeenCalled();
    expect(scope.getRuntimeContext()).toEqual({
      subagentProcesses: [],
      subagentHeartbeats: [],
    });
  });
});
