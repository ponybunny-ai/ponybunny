import { compileAgentConfig } from '../../../src/infra/agents/config/index.js';
import {
  DefaultAgentExecutionEngine,
  SchemaDrivenAgentRunner,
} from '../../../src/infra/agents/schema-driven-agent-runner.js';

const completeMock = jest.fn();
const checkPermissionMock = jest.fn();
const requestPermissionMock = jest.fn();
const revokeAllForGoalMock = jest.fn();
const isServiceAvailableMock = jest.fn();

jest.mock('../../../src/infra/llm/provider-manager/provider-manager.js', () => ({
  getLLMProviderManager: () => ({
    complete: completeMock,
  }),
}));

jest.mock('better-sqlite3', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
}));

jest.mock('../../../src/infra/permission/os-service-checker.js', () => ({
  OSPermissionRepository: class {
    initialize(): void {}
  },
  OSServiceChecker: class {
    checkPermission = checkPermissionMock;
    requestPermission = requestPermissionMock;
    revokeAllForGoal = revokeAllForGoalMock;
    isServiceAvailable = isServiceAvailableMock;
  },
}));

jest.mock('../../../src/infra/config/runtime-config.js', () => ({
  loadRuntimeConfig: jest.fn(),
}));

const { loadRuntimeConfig } = jest.requireMock('../../../src/infra/config/runtime-config.js') as {
  loadRuntimeConfig: jest.Mock;
};

describe('SchemaDrivenAgentRunner', () => {
  const buildRuntimeConfig = (personaEnabled: boolean) => ({
    paths: {
      database: '/tmp/pony.db',
      schedulerSocket: '/tmp/pony.sock',
    },
    gateway: {
      host: '127.0.0.1',
      port: 8080,
    },
    scheduler: {
      tickIntervalMs: 1000,
      maxConcurrentGoals: 5,
      agentsEnabled: true,
      deterministicRuntimeEnabled: false,
      planCompilerEnabled: false,
      toolRoutingMode: 'legacy',
    },
    agent: {
      mainAgentId: 'lead',
      personaEnabled,
    },
    debug: {
      serverPort: 3001,
      loggingEnabled: false,
      antigravityDebug: false,
    },
  });

  beforeEach(() => {
    completeMock.mockReset();
    checkPermissionMock.mockReset();
    requestPermissionMock.mockReset();
    revokeAllForGoalMock.mockReset();
    isServiceAvailableMock.mockReset();
  });

  it('prepends persona prompt when runtime persona is enabled', async () => {
    loadRuntimeConfig.mockReturnValue(buildRuntimeConfig(true));

    const runner = new SchemaDrivenAgentRunner();
    const config = compileAgentConfig({
      schemaVersion: 1,
      id: 'lead',
      name: 'Lead',
      description: 'Main agent',
      enabled: true,
      type: 'growth',
      subAgents: [],
      schedule: { everyMs: 60000, catchUp: { mode: 'coalesce' } },
      policy: {
        toolAllowlist: ['llm.classify'],
        forbiddenPatterns: [],
        prompts: {
          detect_system: 'Return ONLY valid JSON.',
        },
        limits: {
          lead_summary_max_chars: 1000,
        },
      },
      runner: {
        engine: 'default',
        config: {
          tick_defaults: {
            max_events_per_tick: 10,
            max_tasks_per_tick: 10,
            default_lookback_window: '24h',
          },
          circuit_breaker: {
            failure_threshold: 3,
            backoff_minutes: 5,
          },
        },
      },
    });

    await runner.runTick({
      agentId: 'lead',
      config,
      tick: {
        now: new Date('2026-02-23T12:00:00.000Z'),
        runKey: 'run-1',
      },
    });

    expect(completeMock).toHaveBeenCalledTimes(1);
    const firstCall = completeMock.mock.calls[0] as [string, Array<{ role: string; content: string }>];
    expect(firstCall[0]).toBe('lead');
    expect(firstCall[1][0].role).toBe('system');
    expect(firstCall[1][0].content).toContain('Pony');
    expect(firstCall[1][0].content).toContain('Return ONLY valid JSON.');
  });

  it('emits parentAgentId in payload for subagent route context', async () => {
    loadRuntimeConfig.mockReturnValue(buildRuntimeConfig(false));

    const runner = new SchemaDrivenAgentRunner();
    const config = compileAgentConfig({
      schemaVersion: 1,
      id: 'scout',
      name: 'Scout',
      description: 'Subagent',
      enabled: true,
      type: 'growth',
      subAgents: [],
      schedule: { everyMs: 60000, catchUp: { mode: 'coalesce' } },
      policy: {
        toolAllowlist: ['llm.classify'],
        forbiddenPatterns: [],
        prompts: {
          detect_system: 'Subagent prompt',
        },
        limits: {
          lead_summary_max_chars: 1000,
        },
      },
      runner: {
        engine: 'default',
        config: {
          tick_defaults: {
            max_events_per_tick: 10,
            max_tasks_per_tick: 10,
            default_lookback_window: '24h',
          },
          circuit_breaker: {
            failure_threshold: 3,
            backoff_minutes: 5,
          },
        },
      },
    });

    await runner.runTick({
      agentId: 'scout',
      config,
      tick: {
        now: new Date('2026-02-23T12:00:00.000Z'),
        runKey: 'run-2',
        workDir: '/tmp/pony-scout-workdir',
        routeContext: {
          source: 'scheduler.cron',
          agentId: 'lead',
          isSubagent: true,
        },
      },
    });

    expect(completeMock).toHaveBeenCalledTimes(1);
    const firstCall = completeMock.mock.calls[0] as [string, Array<{ role: string; content: string }>];
    const userPrompt = firstCall[1][1].content;
    const jsonStart = userPrompt.indexOf('{');
    const payload = JSON.parse(userPrompt.slice(jsonStart)) as {
      isSubagent: boolean;
      parentAgentId?: string;
      workDir?: string;
    };

    expect(payload.isSubagent).toBe(true);
    expect(payload.parentAgentId).toBe('lead');
    expect(payload.workDir).toBe('/tmp/pony-scout-workdir');
  });

  it('requests missing OS permission and blocks stage execution', async () => {
    loadRuntimeConfig.mockReturnValue(buildRuntimeConfig(false));
    isServiceAvailableMock.mockResolvedValue(true);
    checkPermissionMock.mockResolvedValue({ granted: false, cached: false });
    requestPermissionMock.mockResolvedValue('req-1');

    const runner = new SchemaDrivenAgentRunner();
    const config = compileAgentConfig({
      schemaVersion: 1,
      id: 'lead',
      name: 'Lead',
      description: 'Main agent',
      enabled: true,
      type: 'growth',
      subAgents: [],
      schedule: { everyMs: 60000, catchUp: { mode: 'coalesce' } },
      policy: {
        toolAllowlist: ['llm.classify'],
        forbiddenPatterns: [],
        prompts: {
          detect_system: 'Prompt',
        },
        limits: {
          lead_summary_max_chars: 1000,
        },
      },
      runner: {
        engine: 'default',
        config: {
          os_permissions: [
            { service: 'network', scope: 'api.example.com:443', reason: 'Need outbound API call' },
          ],
          tick_defaults: {
            max_events_per_tick: 10,
            max_tasks_per_tick: 10,
            default_lookback_window: '24h',
          },
          circuit_breaker: {
            failure_threshold: 3,
            backoff_minutes: 5,
          },
        },
      },
    });

    await expect(
      runner.runTick({
        agentId: 'lead',
        config,
        tick: {
          now: new Date('2026-02-23T12:00:00.000Z'),
          runKey: 'run-3',
          goalId: 'goal-1',
        },
      })
    ).rejects.toThrow('OS permission approval required');

    expect(completeMock).not.toHaveBeenCalled();
    expect(requestPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'network',
        scope: 'api.example.com:443',
        goalId: 'goal-1',
      })
    );
    expect(revokeAllForGoalMock).not.toHaveBeenCalled();
  });

  it('delegates subagent runtime context to the execution boundary', async () => {
    loadRuntimeConfig.mockReturnValue(buildRuntimeConfig(false));

    const stopMock = jest.fn(async () => undefined);
    const startExecutionMock = jest.fn(async () => ({
      getRuntimeContext: () => ({
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
      }),
      stop: stopMock,
    }));

    const runner = new SchemaDrivenAgentRunner(
      undefined,
      new DefaultAgentExecutionEngine({
        startExecution: startExecutionMock,
        listAgentCapabilities: jest.fn(),
      })
    );
    const config = compileAgentConfig({
      schemaVersion: 1,
      id: 'lead',
      name: 'Lead',
      description: 'Main agent',
      enabled: true,
      type: 'growth',
      subAgents: ['scout'],
      schedule: { everyMs: 60000, catchUp: { mode: 'coalesce' } },
      policy: {
        toolAllowlist: ['llm.classify'],
        forbiddenPatterns: [],
        prompts: {
          detect_system: 'Prompt',
        },
        limits: {
          lead_summary_max_chars: 1000,
        },
      },
      runner: {
        engine: 'default',
        config: {
          tick_defaults: {
            max_events_per_tick: 10,
            max_tasks_per_tick: 10,
            default_lookback_window: '24h',
          },
          circuit_breaker: {
            failure_threshold: 3,
            backoff_minutes: 5,
          },
        },
      },
    });

    await runner.runTick({
      agentId: 'lead',
      config,
      tick: {
        now: new Date('2026-02-23T12:00:00.000Z'),
        runKey: 'run-4b',
        goalId: 'goal-4b',
      },
    });

    expect(startExecutionMock).toHaveBeenCalledWith({
      agentId: 'lead',
      runKey: 'run-4b',
      goalId: 'goal-4b',
      isSubagent: false,
      subAgents: ['scout'],
    });
    const firstCall = completeMock.mock.calls[0] as [string, Array<{ role: string; content: string }>];
    const userPrompt = firstCall[1][1].content;
    const payload = JSON.parse(userPrompt.slice(userPrompt.indexOf('{'))) as {
      subagentProcesses: Array<{ subagentId: string; pid: number }>;
      subagentHeartbeats: Array<{ subagentId: string; pid: number; lastHeartbeatAtMs: number }>;
    };
    expect(payload.subagentProcesses).toEqual([{ subagentId: 'scout', pid: 9911 }]);
    expect(payload.subagentHeartbeats).toEqual([
      {
        subagentId: 'scout',
        pid: 9911,
        lastHeartbeatAtMs: 42,
        stale: false,
      },
    ]);
    expect(stopMock).toHaveBeenCalled();
  });

  it('revokes OS permissions after successful run', async () => {
    loadRuntimeConfig.mockReturnValue(buildRuntimeConfig(false));
    isServiceAvailableMock.mockResolvedValue(true);
    checkPermissionMock.mockResolvedValue({ granted: true, cached: true, expiresAt: Date.now() + 300000 });

    const runner = new SchemaDrivenAgentRunner();
    const config = compileAgentConfig({
      schemaVersion: 1,
      id: 'lead',
      name: 'Lead',
      description: 'Main agent',
      enabled: true,
      type: 'growth',
      subAgents: [],
      schedule: { everyMs: 60000, catchUp: { mode: 'coalesce' } },
      policy: {
        toolAllowlist: ['llm.classify'],
        forbiddenPatterns: [],
        prompts: {
          detect_system: 'Prompt',
        },
        limits: {
          lead_summary_max_chars: 1000,
        },
      },
      runner: {
        engine: 'default',
        config: {
          os_permissions: [
            { service: 'network', scope: 'api.example.com:443', reason: 'Need outbound API call' },
          ],
          tick_defaults: {
            max_events_per_tick: 10,
            max_tasks_per_tick: 10,
            default_lookback_window: '24h',
          },
          circuit_breaker: {
            failure_threshold: 3,
            backoff_minutes: 5,
          },
        },
      },
    });

    await runner.runTick({
      agentId: 'lead',
      config,
      tick: {
        now: new Date('2026-02-23T12:00:00.000Z'),
        runKey: 'run-4',
        goalId: 'goal-2',
      },
    });

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(revokeAllForGoalMock).toHaveBeenCalledWith('goal-2');
  });
});
