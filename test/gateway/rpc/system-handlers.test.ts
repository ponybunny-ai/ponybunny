import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import * as runtimeConfig from '../../../src/infra/config/runtime-config.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { GatewayError, ErrorCodes } from '../../../src/gateway/errors.js';
import { registerSystemHandlers } from '../../../src/gateway/rpc/handlers/system-handlers.js';
import type { ConnectionManager } from '../../../src/gateway/connection/connection-manager.js';
import type { ISchedulerCore } from '../../../src/scheduler/core/index.js';

const getSchedulerCapabilitiesMock = jest.fn();

jest.mock('../../../src/infra/scheduler/capabilities.js', () => ({
  getSchedulerCapabilities: (...args: unknown[]) => getSchedulerCapabilitiesMock(...args),
}));

function createSession(permissions: Array<'read' | 'write' | 'admin'>): Session {
  return new Session({
    id: 'sess-1',
    publicKey: 'pk-test',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

describe('system handlers', () => {
  let rpc: RpcHandler;
  let mockConnectionManager: ConnectionManager;
  let mockScheduler: ISchedulerCore;

  beforeEach(() => {
    rpc = new RpcHandler();

    mockConnectionManager = {
      getStats: jest.fn(() => ({
        totalSessions: 1,
        pendingConnections: 0,
        uniqueIps: 1,
        connectionsByIp: { '127.0.0.1': 1 },
      })),
    } as unknown as ConnectionManager;

    mockScheduler = {
      getState: jest.fn(() => ({
        status: 'running',
        activeGoals: ['goal-1'],
        lastTickAt: Date.now(),
        errorCount: 0,
      })),
      getMetrics: jest.fn(() => ({
        totalGoalsProcessed: 10,
        totalWorkItemsCompleted: 20,
        totalRunsExecuted: 25,
        averageWorkItemDurationMs: 100,
        successRate: 0.95,
        currentActiveGoals: 1,
        currentActiveWorkItems: 1,
      })),
      on: jest.fn(),
      off: jest.fn(),
      start: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      stop: jest.fn(),
      submitGoal: jest.fn(),
      cancelGoal: jest.fn(),
      getGoalState: jest.fn(),
      getAllGoalStates: jest.fn(),
      tick: jest.fn(),
      applyRuntimeRollout: jest.fn(),
    } as unknown as ISchedulerCore;

    getSchedulerCapabilitiesMock.mockReset();
    getSchedulerCapabilitiesMock.mockReturnValue({
      models: [],
      providers: [],
      tools: [],
      mcpServers: [],
      skills: [],
      agents: [{ id: 'lead', name: 'Lead', type: 'planner', enabled: true, source: 'user', status: 'valid', scheduleKind: 'interval' }],
      summary: {
        totalModels: 0,
        totalProviders: 0,
        totalTools: 0,
        totalMCPServers: 0,
        totalSkills: 0,
        totalAgents: 1,
      },
    });

    registerSystemHandlers(
      rpc,
      () => mockConnectionManager,
      () => mockScheduler,
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      undefined,
      {
        getRuntimeRolloutMetrics: () => ({
          dryRunsTotal: 8,
          dryRunsSucceeded: 7,
          dryRunsFailed: 1,
          successRate: 0.875,
          averagePlanStepCount: 4.2,
          averageChangedStepCount: 1.1,
          failureCodeCounts: {
            ERR_TOOL_NOT_FOUND: 1,
          },
          lastDryRunAt: 1710000000000,
          retentionRunsTotal: 0,
          retentionDeletedTotal: 0,
          retentionFailedTotal: 0,
          sessionFirst: {
            sessionCreationsTotal: 3,
            sessionCreationsSucceeded: 3,
            sessionCreationSuccessRate: 1,
            conversationMessagesTotal: 12,
            conversationMessagesSucceeded: 10,
            conversationMessagesFailed: 2,
            conversationMessageSuccessRate: 10 / 12,
            goalsTotal: 8,
            goalsWithSessionLink: 7,
            goalSessionCoverageRate: 0.875,
            runsTotal: 6,
            runsSucceeded: 5,
            runsFailed: 1,
            runSuccessRate: 5 / 6,
            averageRunLatencyMs: 1200,
          },
        }),
      }
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns system.capabilities for read sessions', async () => {
    const session = createSession(['read']);

    const result = await rpc.handle('system.capabilities', {}, session);

    expect(getSchedulerCapabilitiesMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        schedulerConnected: true,
        capabilities: expect.objectContaining({
          summary: expect.objectContaining({ totalAgents: 1 }),
        }),
      })
    );
  });

  it('denies system.capabilities when read permission is missing', async () => {
    const session = createSession([]);

    await expect(rpc.handle('system.capabilities', {}, session)).rejects.toMatchObject<Partial<GatewayError>>({
      code: ErrorCodes.PERMISSION_DENIED,
    });
  });

  it('reports schedulerConnected false when scheduler is unavailable', async () => {
    const rpcWithoutScheduler = new RpcHandler();
    registerSystemHandlers(
      rpcWithoutScheduler,
      () => mockConnectionManager,
      () => null,
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: false })
    );

    const result = await rpcWithoutScheduler.handle('system.capabilities', {}, createSession(['read']));

    expect(result).toEqual(
      expect.objectContaining({
        schedulerConnected: false,
      })
    );
  });

  it('returns runtime rollout status', async () => {
    jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue({
      ...runtimeConfig.DEFAULT_RUNTIME_CONFIG,
      scheduler: {
        ...runtimeConfig.DEFAULT_RUNTIME_CONFIG.scheduler,
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_only',
        runtimeRollout: {
          shadowModeEnabled: true,
          canaryPercent: 25,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 5,
            compile: 0,
            replay: 0,
          },
        },
      },
    });

    const result = await rpc.handle('system.runtime.rollout.status', {}, createSession(['read']));
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'shadow',
        rollout: expect.objectContaining({
          canaryPercent: 25,
        }),
        metrics: expect.objectContaining({
          dryRunsTotal: 8,
          dryRunsSucceeded: 7,
          sessionFirst: expect.objectContaining({
            goalsTotal: 8,
            goalsWithSessionLink: 7,
            goalSessionCoverageRate: 0.875,
          }),
        }),
      })
    );
  });

  it('updates runtime rollout config and supports rollback to legacy', async () => {
    const currentConfig = {
      ...runtimeConfig.DEFAULT_RUNTIME_CONFIG,
      scheduler: {
        ...runtimeConfig.DEFAULT_RUNTIME_CONFIG.scheduler,
        deterministicRuntimeEnabled: true,
        planCompilerEnabled: true,
        toolRoutingMode: 'system_preferred' as const,
        runtimeRollout: {
          shadowModeEnabled: false,
          canaryPercent: 50,
          rollbackOnFailure: false,
          lanePercents: {
            dryRun: 0,
            compile: 10,
            replay: 0,
          },
        },
      },
    };

    const loadSpy = jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue(currentConfig);
    const saveSpy = jest.spyOn(runtimeConfig, 'saveRuntimeConfig').mockImplementation(() => undefined);

    const updateResult = await rpc.handle(
      'system.runtime.rollout.update',
      {
        shadowModeEnabled: true,
        canaryPercent: 10,
        lanePercents: { dryRun: 20, compile: 15 },
        rollbackOnFailure: true,
      },
      createSession(['admin'])
    );

    expect(updateResult).toEqual(
      expect.objectContaining({
        mode: 'shadow',
        rollout: expect.objectContaining({
          shadowModeEnabled: true,
          canaryPercent: 10,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 20,
            compile: 15,
            replay: 0,
          },
        }),
      })
    );
    expect(saveSpy).toHaveBeenCalledTimes(1);

    const rollbackResult = await rpc.handle(
      'system.runtime.rollout.update',
      { rollbackToLegacy: true },
      createSession(['admin'])
    );

    expect(rollbackResult).toEqual(
      expect.objectContaining({
        mode: 'legacy',
      })
    );
    expect(loadSpy).toHaveBeenCalled();
  });

  it('rejects invalid canary percent', async () => {
    jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue(runtimeConfig.DEFAULT_RUNTIME_CONFIG);

    await expect(
      rpc.handle('system.runtime.rollout.update', { canaryPercent: 101 }, createSession(['admin']))
    ).rejects.toMatchObject<Partial<GatewayError>>({
      code: ErrorCodes.INVALID_PARAMS,
    });
  });

  it('reports canary mode when lane percent is enabled', async () => {
    jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue({
      ...runtimeConfig.DEFAULT_RUNTIME_CONFIG,
      scheduler: {
        ...runtimeConfig.DEFAULT_RUNTIME_CONFIG.scheduler,
        runtimeRollout: {
          shadowModeEnabled: false,
          canaryPercent: 0,
          rollbackOnFailure: true,
          lanePercents: {
            dryRun: 0,
            compile: 25,
            replay: 0,
          },
        },
      },
    });

    const result = await rpc.handle('system.runtime.rollout.status', {}, createSession(['read']));
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'canary',
      })
    );
  });

  it('overrides session-goal coverage metrics when callback is provided', async () => {
    const rpcWithCoverage = new RpcHandler();
    registerSystemHandlers(
      rpcWithCoverage,
      () => mockConnectionManager,
      () => mockScheduler,
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      undefined,
      {
        getRuntimeRolloutMetrics: () => ({
          dryRunsTotal: 1,
          dryRunsSucceeded: 1,
          dryRunsFailed: 0,
          successRate: 1,
          averagePlanStepCount: 1,
          averageChangedStepCount: 0,
          failureCodeCounts: {},
          retentionRunsTotal: 0,
          retentionDeletedTotal: 0,
          retentionFailedTotal: 0,
          sessionFirst: {
            sessionCreationsTotal: 1,
            sessionCreationsSucceeded: 1,
            sessionCreationSuccessRate: 1,
            conversationMessagesTotal: 1,
            conversationMessagesSucceeded: 1,
            conversationMessagesFailed: 0,
            conversationMessageSuccessRate: 1,
            goalsTotal: 1,
            goalsWithSessionLink: 1,
            goalSessionCoverageRate: 1,
            runsTotal: 1,
            runsSucceeded: 1,
            runsFailed: 0,
            runSuccessRate: 1,
            averageRunLatencyMs: 20,
          },
        }),
        getSessionGoalCoverage: () => ({
          goalsTotal: 10,
          goalsWithSessionLink: 6,
          goalSessionCoverageRate: 0.6,
        }),
      }
    );

    const result = await rpcWithCoverage.handle('system.runtime.rollout.status', {}, createSession(['read'])) as {
      metrics: { sessionFirst: { goalsTotal: number; goalsWithSessionLink: number; goalSessionCoverageRate: number } };
    };

    expect(result.metrics.sessionFirst.goalsTotal).toBe(10);
    expect(result.metrics.sessionFirst.goalsWithSessionLink).toBe(6);
    expect(result.metrics.sessionFirst.goalSessionCoverageRate).toBe(0.6);
  });
});
