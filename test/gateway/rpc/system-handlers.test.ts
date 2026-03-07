import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import * as runtimeConfig from '../../../src/infra/config/runtime-config.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { GatewayError, ErrorCodes } from '../../../src/gateway/errors.js';
import { registerSystemHandlers } from '../../../src/gateway/rpc/handlers/system-handlers.js';
import type { ConnectionManager } from '../../../src/gateway/connection/connection-manager.js';
import type { ChannelRouter } from '../../../src/gateway/channels/channel-router.js';
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
  let mockChannelRouter: ChannelRouter;

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

    mockChannelRouter = {
      getEnabledChannels: jest.fn(() => ['tui']),
      getMirrorToAllEnabledChannels: jest.fn(() => true),
      setEnabledChannels: jest.fn(),
      setMirrorToAllEnabledChannels: jest.fn(),
      setSessionChannel: jest.fn(),
      clearSessionChannel: jest.fn(),
      buildSessionFilter: jest.fn(() => () => true),
    } as unknown as ChannelRouter;

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
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [],
      undefined,
      undefined,
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
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: false }),
      () => []
    );

    const result = await rpcWithoutScheduler.handle('system.capabilities', {}, createSession(['read']));

    expect(result).toEqual(
      expect.objectContaining({
        schedulerConnected: false,
      })
    );
  });

  it('exposes realtime ack and stream latency metrics in system.status', async () => {
    const rpcWithRealtime = new RpcHandler();
    registerSystemHandlers(
      rpcWithRealtime,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [],
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({
        schedulerCommandAckMsP95: 180,
        streamChunkLatencyMsP95: 640,
        ackSampleSize: 42,
        streamSampleSize: 16,
      })
    );

    const result = await rpcWithRealtime.handle('system.status', {}, createSession(['admin'])) as {
      gateway: {
        realtime: {
          schedulerCommandAckMsP95: number;
          streamChunkLatencyMsP95: number;
          ackSampleSize: number;
          streamSampleSize: number;
        };
      };
    };

    expect(result.gateway.realtime).toEqual({
      schedulerCommandAckMsP95: 180,
      streamChunkLatencyMsP95: 640,
      ackSampleSize: 42,
      streamSampleSize: 16,
    });
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
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [],
      undefined,
      undefined,
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

  it('updates runtime tui config through rpc', async () => {
    jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue({
      ...runtimeConfig.DEFAULT_RUNTIME_CONFIG,
      tui: {
        inputBackgroundColor: 'gray',
        sessionFirstEnabled: true,
        goalSubmitFastPathEnabled: false,
      },
    });
    const saveSpy = jest.spyOn(runtimeConfig, 'saveRuntimeConfig').mockImplementation(() => undefined);

    const result = await rpc.handle(
      'system.runtime.tui.update',
      { sessionFirstEnabled: false, goalSubmitFastPathEnabled: true },
      createSession(['admin'])
    ) as {
      sessionFirstEnabled: boolean;
      goalSubmitFastPathEnabled: boolean;
    };

    expect(result.sessionFirstEnabled).toBe(true);
    expect(result.goalSubmitFastPathEnabled).toBe(false);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it('returns gateway channel routing status', async () => {
    (mockChannelRouter.getEnabledChannels as unknown as jest.Mock).mockReturnValue(['tui', 'webui']);
    (mockChannelRouter.getMirrorToAllEnabledChannels as unknown as jest.Mock).mockReturnValue(false);

    const result = await rpc.handle('system.channels.status', {}, createSession(['read'])) as {
      enabledChannels: string[];
      mirrorToAllEnabledChannels: boolean;
      adapters: unknown[];
      adapterHealth: { total: number; running: number; stopped: number; error: number; available: number };
    };

    expect(result.enabledChannels).toEqual(['tui', 'webui']);
    expect(result.mirrorToAllEnabledChannels).toBe(false);
    expect(result.adapters).toEqual([]);
    expect(result.adapterHealth).toEqual({ total: 0, running: 0, stopped: 0, error: 0, available: 0 });
  });

  it('updates gateway channel routing status', async () => {
    (mockChannelRouter.getEnabledChannels as unknown as jest.Mock).mockReturnValue(['tui', 'discord']);
    (mockChannelRouter.getMirrorToAllEnabledChannels as unknown as jest.Mock).mockReturnValue(true);

    const result = await rpc.handle(
      'system.channels.update',
      {
        enabledChannels: ['tui', 'discord'],
        mirrorToAllEnabledChannels: true,
      },
      createSession(['admin'])
    ) as {
      enabledChannels: string[];
      mirrorToAllEnabledChannels: boolean;
      adapters: unknown[];
      adapterHealth: { total: number; running: number; stopped: number; error: number; available: number };
    };

    expect(mockChannelRouter.setEnabledChannels).toHaveBeenCalledWith(['tui', 'discord']);
    expect(mockChannelRouter.setMirrorToAllEnabledChannels).toHaveBeenCalledWith(true);
    expect(result.enabledChannels).toEqual(['tui', 'discord']);
    expect(result.mirrorToAllEnabledChannels).toBe(true);
    expect(result.adapters).toEqual([]);
    expect(result.adapterHealth).toEqual({ total: 0, running: 0, stopped: 0, error: 0, available: 0 });
  });

  it('updates adapter configs through channels.update and returns adapter statuses', async () => {
    const rpcWithAdapters = new RpcHandler();
    const updateAdapterConfigs = jest.fn(async () => undefined);

    registerSystemHandlers(
      rpcWithAdapters,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [
        {
          channel: 'discord',
          state: 'running',
          available: true,
          config: { botTokenPresent: true },
          startCount: 1,
          stopCount: 0,
          errorCount: 0,
          deliveryCount: 0,
          deliveryErrorCount: 0,
        },
      ],
      updateAdapterConfigs
    );

    const result = await rpcWithAdapters.handle(
      'system.channels.update',
      {
        adapterConfigs: {
          discord: { botToken: 'abc' },
        },
      },
      createSession(['admin'])
    ) as {
      adapters: Array<{ channel: string; state: string; config: Record<string, unknown> }>;
    };

    expect(updateAdapterConfigs).toHaveBeenCalledWith({
      discord: {
        botToken: 'abc',
        webhookUrl: '',
        guildId: '',
        applicationId: '',
        commandsEnabled: true,
        retryAttempts: 2,
        retryBackoffMs: 50,
      },
    });
    expect(result.adapters).toEqual([
      {
        channel: 'discord',
        state: 'running',
        available: true,
        startCount: 1,
        stopCount: 0,
        errorCount: 0,
        deliveryCount: 0,
        deliveryErrorCount: 0,
        config: {
          botToken: '',
          webhookUrl: '',
          guildId: '',
          applicationId: '',
          commandsEnabled: true,
          botTokenPresent: true,
          retryAttempts: 2,
          retryBackoffMs: 50,
        },
      },
    ]);
  });

  it('masks sensitive adapter config fields in channels.status', async () => {
    const rpcWithAdapters = new RpcHandler();

    registerSystemHandlers(
      rpcWithAdapters,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [
        {
          channel: 'discord',
          state: 'running',
          available: true,
          config: { botToken: 'super-secret', commandsEnabled: true },
          startCount: 1,
          stopCount: 0,
          errorCount: 0,
          deliveryCount: 0,
          deliveryErrorCount: 0,
        },
      ]
    );

    const result = await rpcWithAdapters.handle('system.channels.status', {}, createSession(['read'])) as {
      adapters: Array<{ channel: string; config: Record<string, unknown> }>;
    };

    expect(result.adapters).toEqual([
      {
        channel: 'discord',
        state: 'running',
        available: true,
        startCount: 1,
        stopCount: 0,
        errorCount: 0,
        deliveryCount: 0,
        deliveryErrorCount: 0,
        config: {
          botToken: '***',
          webhookUrl: '',
          guildId: '',
          applicationId: '',
          commandsEnabled: true,
          retryAttempts: 2,
          retryBackoffMs: 50,
        },
      },
    ]);
  });

  it('returns adapterHealth aggregate from adapter statuses', async () => {
    const rpcWithAdapters = new RpcHandler();

    registerSystemHandlers(
      rpcWithAdapters,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [
        {
          channel: 'discord',
          state: 'running',
          available: true,
          config: {},
          startCount: 1,
          stopCount: 0,
          errorCount: 0,
          deliveryCount: 0,
          deliveryErrorCount: 0,
          retryTrail: [],
        },
        {
          channel: 'telegram',
          state: 'error',
          available: true,
          config: {},
          startCount: 1,
          stopCount: 0,
          errorCount: 1,
          deliveryCount: 0,
          deliveryErrorCount: 0,
          retryTrail: [
            {
              timestamp: 1700000000000,
              attempt: 2,
              phase: 'start',
              outcome: 'failure',
              reason: 'startup',
              source: 'gateway-startup',
              error: 'network failure',
            },
          ],
        },
      ]
    );

    const result = await rpcWithAdapters.handle('system.channels.status', {}, createSession(['read'])) as {
      adapterHealth: { total: number; running: number; stopped: number; error: number; available: number };
      adapterRecentFailures: Array<{ channel: string; error: string }>;
    };

    expect(result.adapterHealth).toEqual({
      total: 2,
      running: 1,
      stopped: 0,
      error: 1,
      available: 2,
    });
    expect(result.adapterRecentFailures).toEqual([
      {
        channel: 'telegram',
        timestamp: 1700000000000,
        attempt: 2,
        error: 'network failure',
        reason: 'startup',
        source: 'gateway-startup',
      },
    ]);
  });

  it('validates adapter config schema and rejects invalid adapter fields', async () => {
    const rpcWithAdapters = new RpcHandler();
    const updateAdapterConfigs = jest.fn(async () => undefined);

    registerSystemHandlers(
      rpcWithAdapters,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [],
      updateAdapterConfigs
    );

    await expect(
      rpcWithAdapters.handle(
        'system.channels.update',
        {
          adapterConfigs: {
            telegram: { pollingEnabled: 'yes' },
          },
        },
        createSession(['admin'])
      )
    ).rejects.toMatchObject<Partial<GatewayError>>({
      code: ErrorCodes.INVALID_PARAMS,
    });

    expect(updateAdapterConfigs).not.toHaveBeenCalled();
  });

  it('passes validated adapter config payload to update callback', async () => {
    const rpcWithAdapters = new RpcHandler();
    const updateAdapterConfigs = jest.fn(async () => undefined);

    registerSystemHandlers(
      rpcWithAdapters,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [],
      updateAdapterConfigs
    );

    await rpcWithAdapters.handle(
      'system.channels.update',
      {
        adapterConfigs: {
          email: {
            inboundAddress: 'ops@example.com',
            smtpPort: 587,
            useTls: true,
          },
          whatsapp: {
            provider: 'meta',
          },
        },
      },
      createSession(['admin'])
    );

    expect(updateAdapterConfigs).toHaveBeenCalledWith({
      email: {
        inboundAddress: 'ops@example.com',
        smtpHost: '',
        smtpPort: 587,
        useTls: true,
        retryAttempts: 2,
        retryBackoffMs: 50,
      },
      whatsapp: {
        provider: 'meta',
        phoneNumberId: '',
        webhookVerifyToken: '',
        retryAttempts: 2,
        retryBackoffMs: 50,
      },
    });
  });

  it('validates retry policy fields in adapter config payload', async () => {
    const rpcWithAdapters = new RpcHandler();
    const updateAdapterConfigs = jest.fn(async () => undefined);

    registerSystemHandlers(
      rpcWithAdapters,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => [],
      updateAdapterConfigs
    );

    await expect(
      rpcWithAdapters.handle(
        'system.channels.update',
        {
          adapterConfigs: {
            discord: { retryAttempts: 10 },
          },
        },
        createSession(['admin'])
      )
    ).rejects.toMatchObject<Partial<GatewayError>>({
      code: ErrorCodes.INVALID_PARAMS,
    });

    await rpcWithAdapters.handle(
      'system.channels.update',
      {
        adapterConfigs: {
          discord: { retryAttempts: 3, retryBackoffMs: 120 },
        },
      },
      createSession(['admin'])
    );

    expect(updateAdapterConfigs).toHaveBeenLastCalledWith({
      discord: {
        botToken: '',
        webhookUrl: '',
        guildId: '',
        applicationId: '',
        commandsEnabled: true,
        retryAttempts: 3,
        retryBackoffMs: 120,
      },
    });
  });

  it('applies session channel overrides through channels.update', async () => {
    (mockChannelRouter.getEnabledChannels as unknown as jest.Mock).mockReturnValue(['tui']);
    (mockChannelRouter.getMirrorToAllEnabledChannels as unknown as jest.Mock).mockReturnValue(true);

    await rpc.handle(
      'system.channels.update',
      {
        sessionChannelOverrides: [
          { sessionId: 'sess-1', channel: 'discord' },
          { sessionId: 'sess-2', channel: 'webui' },
        ],
      },
      createSession(['admin'])
    );

    expect(mockChannelRouter.setSessionChannel).toHaveBeenNthCalledWith(1, 'sess-1', 'discord');
    expect(mockChannelRouter.setSessionChannel).toHaveBeenNthCalledWith(2, 'sess-2', 'webui');
  });

  it('clears session channel overrides through channels.update', async () => {
    (mockChannelRouter.getEnabledChannels as unknown as jest.Mock).mockReturnValue(['tui']);
    (mockChannelRouter.getMirrorToAllEnabledChannels as unknown as jest.Mock).mockReturnValue(true);

    await rpc.handle(
      'system.channels.update',
      {
        clearSessionChannelOverrides: ['sess-1', 'sess-2'],
      },
      createSession(['admin'])
    );

    expect(mockChannelRouter.clearSessionChannel).toHaveBeenNthCalledWith(1, 'sess-1');
    expect(mockChannelRouter.clearSessionChannel).toHaveBeenNthCalledWith(2, 'sess-2');
  });

  it('filters channel event replay through system.channels.events', async () => {
    const rpcWithEvents = new RpcHandler();
    const events = [
      {
        id: 'evt-1',
        event: 'conversation.response',
        timestamp: 100,
        channelType: 'discord',
        channelSessionId: 'discord-1',
        sessionId: 'session-1',
        payload: { text: 'a' },
      },
      {
        id: 'evt-2',
        event: 'conversation.message.succeeded',
        timestamp: 200,
        channelType: 'tui',
        channelSessionId: 'tui-1',
        sessionId: 'session-2',
        payload: { text: 'b' },
      },
      {
        id: 'evt-3',
        event: 'conversation.response',
        timestamp: 300,
        channelType: 'discord',
        channelSessionId: 'discord-2',
        sessionId: 'session-3',
        payload: { text: 'c' },
      },
    ] as const;

    registerSystemHandlers(
      rpcWithEvents,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [...events],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => []
    );

    const result = await rpcWithEvents.handle(
      'system.channels.events',
      {
        channelType: 'discord',
        sinceTimestamp: 150,
        limit: 10,
      },
      createSession(['read'])
    ) as {
      events: Array<{ id: string }>;
    };

    expect(result.events.map((item) => item.id)).toEqual(['evt-3']);
  });

  it('filters channel event replay by event prefix and scheduler identifiers', async () => {
    const rpcWithEvents = new RpcHandler();
    const events = [
      {
        id: 'evt-run-1',
        event: 'run.started',
        timestamp: 100,
        goalId: 'goal-a',
        workItemId: 'work-a',
        runId: 'run-a',
        payload: { ok: true },
      },
      {
        id: 'evt-run-2',
        event: 'run.completed',
        timestamp: 200,
        goalId: 'goal-b',
        workItemId: 'work-b',
        runId: 'run-b',
        payload: { ok: true },
      },
      {
        id: 'evt-goal-1',
        event: 'goal.completed',
        timestamp: 300,
        goalId: 'goal-b',
        payload: { ok: true },
      },
    ] as const;

    registerSystemHandlers(
      rpcWithEvents,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [...events],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => []
    );

    const result = await rpcWithEvents.handle(
      'system.channels.events',
      {
        eventPrefix: 'run.',
        goalId: 'goal-b',
        runId: 'run-b',
      },
      createSession(['read'])
    ) as {
      events: Array<{ id: string }>;
    };

    expect(result.events.map((item) => item.id)).toEqual(['evt-run-2']);
  });

  it('supports cursor pagination for system.channels.events replay', async () => {
    const rpcWithEvents = new RpcHandler();
    const events = [
      { id: 'evt-1', event: 'conversation.response', timestamp: 100, payload: {} },
      { id: 'evt-2', event: 'conversation.response', timestamp: 200, payload: {} },
      { id: 'evt-3', event: 'conversation.response', timestamp: 300, payload: {} },
    ];

    registerSystemHandlers(
      rpcWithEvents,
      () => mockConnectionManager,
      () => mockScheduler,
      () => mockChannelRouter,
      () => [...events],
      () => ({ isRunning: true, daemonConnected: true, schedulerConnected: true }),
      () => []
    );

    const firstPage = await rpcWithEvents.handle(
      'system.channels.events',
      { limit: 2, cursor: '0' },
      createSession(['read'])
    ) as { events: Array<{ id: string }>; nextCursor?: string };

    expect(firstPage.events.map((item) => item.id)).toEqual(['evt-1', 'evt-2']);
    expect(firstPage.nextCursor).toBe('2');

    const secondPage = await rpcWithEvents.handle(
      'system.channels.events',
      { limit: 2, cursor: firstPage.nextCursor },
      createSession(['read'])
    ) as { events: Array<{ id: string }>; nextCursor?: string };

    expect(secondPage.events.map((item) => item.id)).toEqual(['evt-3']);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it('persists main agent model hint through rpc', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-system-model-hint-'));
    const previousConfigDir = process.env.PONYBUNNY_CONFIG_DIR;
    process.env.PONYBUNNY_CONFIG_DIR = tempRoot;

    const agentDir = path.join(tempRoot, 'agents', 'lead');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify({ id: 'lead', runner: { id: 'react-goal', config: {} } }, null, 2));

    const runtimeSpy = jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue({
      ...runtimeConfig.DEFAULT_RUNTIME_CONFIG,
      agent: {
        ...runtimeConfig.DEFAULT_RUNTIME_CONFIG.agent,
        mainAgentId: 'lead',
      },
    });

    try {
      const result = await rpc.handle(
        'system.agent.model_hint.set',
        { model: 'openai.gpt-5.2' },
        createSession(['admin'])
      ) as {
        success: boolean;
        agentId: string;
        model: string;
      };

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('lead');
      expect(result.model).toBe('openai.gpt-5.2');

      const persisted = JSON.parse(fs.readFileSync(path.join(agentDir, 'agent.json'), 'utf-8')) as {
        runner?: { config?: { model_hint?: string } };
      };
      expect(persisted.runner?.config?.model_hint).toBe('openai.gpt-5.2');
      expect(runtimeSpy).toHaveBeenCalled();
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.PONYBUNNY_CONFIG_DIR;
      } else {
        process.env.PONYBUNNY_CONFIG_DIR = previousConfigDir;
      }
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
