const configureLLMProviderManagerStreamEventSink = jest.fn();
const setGlobalToolProvider = jest.fn();
const getSchedulerCapabilitiesMock = jest.fn();

jest.mock('../../../src/infra/llm/provider-manager/index.js', () => ({
  configureLLMProviderManagerStreamEventSink,
}));

jest.mock('../../../src/infra/tools/tool-provider.js', () => {
  const actual = jest.requireActual('../../../src/infra/tools/tool-provider.js');

  return {
    ...actual,
    setGlobalToolProvider,
  };
});

jest.mock('../../../src/infra/scheduler/capabilities.js', () => ({
  getSchedulerCapabilities: (...args: unknown[]) => getSchedulerCapabilitiesMock(...args),
}));

import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { createNoOpLLMStreamEventSink } from '../../../src/infra/llm/provider-manager/stream-event-sink.js';
import { createGatewayToolProviderRuntimeCluster } from '../../../src/gateway/runtime/gateway-tool-provider-runtime-cluster.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { GatewayDaemonOperationState } from '../../../src/gateway/integration/gateway-daemon-attachment.js';

function createSession(permissions: Array<'read' | 'write' | 'admin'>): Session {
  return new Session({
    id: 'sess-runtime-cluster-1',
    publicKey: 'pk-runtime-cluster-test',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

function createDetachedDaemonState(): GatewayDaemonOperationState {
  return {
    attachment: {
      daemon: null,
      status: {
        phase: 'detached',
        connected: false,
        connectedAt: null,
      },
    },
    detach: {
      phase: 'idle',
      attached: false,
      detachSupported: true,
      unsubscribeSupported: false,
    },
  };
}

describe('GatewayToolProviderRuntime cluster', () => {
  beforeEach(() => {
    configureLLMProviderManagerStreamEventSink.mockReset();
    setGlobalToolProvider.mockReset();
    getSchedulerCapabilitiesMock.mockReset();
    getSchedulerCapabilitiesMock.mockImplementation(async (toolRegistry?: { getAllTools(): Array<unknown> }) => ({
      models: [],
      providers: [],
      tools: [],
      mcpServers: [],
      skills: [],
      agents: [],
      summary: {
        totalModels: 0,
        totalProviders: 0,
        totalTools: toolRegistry?.getAllTools().length ?? 0,
        totalMCPServers: 0,
        totalSkills: 0,
        totalAgents: 0,
      },
    }));
  });

  it('assembles the tool-provider runtime once and publishes the registry facet to adjacent runtime control surfaces', async () => {
    const rpcHandler = new RpcHandler();
    const runtimeCluster = createGatewayToolProviderRuntimeCluster({
      streamEventSink: createNoOpLLMStreamEventSink(),
      rpcHandler,
      repository: {} as IWorkOrderRepository,
      getIsRunning: () => true,
      connectionManager: {
        getStats: jest.fn(() => ({
          totalSessions: 0,
          pendingConnections: 0,
          uniqueIps: 0,
          connectionsByIp: {},
        })),
      } as any,
      channelRuntime: {
        channelRouter: {},
        getStoredEvents: jest.fn(() => []),
        getAdapterStatuses: jest.fn(() => []),
        applyEnabledChannels: jest.fn(),
        applyChannelRoutingUpdate: jest.fn(),
        updateAdapterConfigs: jest.fn(),
      } as any,
      daemonAttachment: {
        getOperationState: jest.fn(() => createDetachedDaemonState()),
      } as any,
      schedulerBridge: {
        isConnected: jest.fn(() => false),
      } as any,
      getScheduler: () => null,
      ipcBridge: {
        getRealtimeMetrics: jest.fn(() => ({
          schedulerCommandAckMsP95: 0,
          streamChunkLatencyMsP95: 0,
          ackSampleSize: 0,
          streamSampleSize: 0,
        })),
        isSchedulerDaemonConnected: jest.fn(() => false),
        setAgentModelOverride: jest.fn(),
        getAgentModelOverride: jest.fn(),
      } as any,
      runtimeRolloutCoordinator: {
        getMetricsSnapshot: jest.fn(() => ({
          dryRunsTotal: 0,
          dryRunsSucceeded: 0,
          dryRunsFailed: 0,
          successRate: 0,
          averagePlanStepCount: 0,
          averageChangedStepCount: 0,
          failureCodeCounts: {},
          lastDryRunAt: 0,
          retentionRunsTotal: 0,
          retentionDeletedTotal: 0,
          retentionFailedTotal: 0,
          sessionFirst: {
            sessionCreationsTotal: 0,
            sessionCreationsSucceeded: 0,
            sessionCreationSuccessRate: 0,
            conversationMessagesTotal: 0,
            conversationMessagesSucceeded: 0,
            conversationMessagesFailed: 0,
            conversationMessageSuccessRate: 0,
            goalsTotal: 0,
            goalsWithSessionLink: 0,
            goalSessionCoverageRate: 0,
            runsTotal: 0,
            runsSucceeded: 0,
            runsFailed: 0,
            runSuccessRate: 0,
            averageRunLatencyMs: 0,
          },
        })),
        collectSessionGoalCoverage: jest.fn(() => ({
          goalsTotal: 0,
          goalsWithSessionLink: 0,
          goalSessionCoverageRate: 0,
        })),
        applyRuntimeRolloutUpdate: jest.fn(),
        handleDryRunComplete: jest.fn(),
      } as any,
    });

    runtimeCluster.runtimeRpcSurface.register();

    const systemCapabilities = await rpcHandler.handle(
      'system.capabilities',
      {},
      createSession(['read'])
    ) as {
      capabilities: {
        summary: {
          totalTools: number;
        };
      };
    };
    const manifestValidation = await rpcHandler.handle(
      'internal.toolManifest.validate',
      {},
      createSession(['admin'])
    ) as {
      totalTools: number;
    };

    expect(getSchedulerCapabilitiesMock).toHaveBeenCalledWith(runtimeCluster.toolProviderRuntime.toolRegistry);
    expect(systemCapabilities.capabilities.summary.totalTools).toBe(
      runtimeCluster.toolProviderRuntime.toolRegistry.getAllTools().length
    );
    expect(manifestValidation.totalTools).toBe(
      runtimeCluster.toolProviderRuntime.toolRegistry.getAllTools().length
    );
  });
});
