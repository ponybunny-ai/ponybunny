import type { ConnectionManager } from '../connection/connection-manager.js';
import type { GatewayChannelRuntime } from '../channels/gateway-channel-runtime.js';
import type { GatewayDaemonAttachment, GatewayDaemonAttachmentStatus, GatewayDaemonDetachStatus } from '../integration/gateway-daemon-attachment.js';
import type { SchedulerBridge } from '../integration/scheduler-bridge.js';
import type { IPCBridge } from '../integration/ipc-bridge.js';
import type { RpcHandler } from '../rpc/rpc-handler.js';
import { registerSystemHandlers } from '../rpc/handlers/system-handlers.js';
import { registerInternalRuntimeHandlers } from '../rpc/handlers/internal-runtime-handlers.js';
import type { GatewayRuntimeRolloutCoordinator } from './gateway-runtime-rollout-coordinator.js';
import type { ToolRegistry } from '../../infra/tools/tool-registry.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { ISchedulerCore } from '../../scheduler/core/index.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';

export interface GatewayRuntimeRpcSurfaceDependencies {
  rpcHandler: RpcHandler;
  repository: IWorkOrderRepository;
  getIsRunning: () => boolean;
  connectionManager: ConnectionManager;
  channelRuntime: GatewayChannelRuntime;
  daemonAttachment: GatewayDaemonAttachment;
  schedulerBridge: SchedulerBridge;
  getScheduler: () => ISchedulerCore | null;
  ipcBridge: IPCBridge;
  runtimeRolloutCoordinator: GatewayRuntimeRolloutCoordinator;
  toolRegistry: ToolRegistry;
}

export class GatewayRuntimeRpcSurface {
  private readonly rpcHandler: RpcHandler;
  private readonly repository: IWorkOrderRepository;
  private readonly getIsRunning: () => boolean;
  private readonly connectionManager: ConnectionManager;
  private readonly channelRuntime: GatewayChannelRuntime;
  private readonly daemonAttachment: GatewayDaemonAttachment;
  private readonly schedulerBridge: SchedulerBridge;
  private readonly getScheduler: () => ISchedulerCore | null;
  private readonly ipcBridge: IPCBridge;
  private readonly runtimeRolloutCoordinator: GatewayRuntimeRolloutCoordinator;
  private readonly toolRegistry: ToolRegistry;

  constructor(dependencies: GatewayRuntimeRpcSurfaceDependencies) {
    this.rpcHandler = dependencies.rpcHandler;
    this.repository = dependencies.repository;
    this.getIsRunning = dependencies.getIsRunning;
    this.connectionManager = dependencies.connectionManager;
    this.channelRuntime = dependencies.channelRuntime;
    this.daemonAttachment = dependencies.daemonAttachment;
    this.schedulerBridge = dependencies.schedulerBridge;
    this.getScheduler = dependencies.getScheduler;
    this.ipcBridge = dependencies.ipcBridge;
    this.runtimeRolloutCoordinator = dependencies.runtimeRolloutCoordinator;
    this.toolRegistry = dependencies.toolRegistry;
  }

  register(): void {
    registerSystemHandlers(
      this.rpcHandler,
      () => this.connectionManager,
      this.getScheduler,
      () => this.channelRuntime.channelRouter,
      () => this.channelRuntime.getStoredEvents(),
      () => this.getGatewayStatusSnapshot(),
      () => this.channelRuntime.getAdapterStatuses(),
      undefined,
      async () => {
        await this.channelRuntime.applyEnabledChannels('channel-toggle', 'channel-router');
      },
      () => this.toolRegistry,
      {
        getRuntimeRolloutMetrics: () => this.runtimeRolloutCoordinator.getMetricsSnapshot(),
        getSessionGoalCoverage: () => this.runtimeRolloutCoordinator.collectSessionGoalCoverage(),
        applyRuntimeRollout: async (rollout) => this.runtimeRolloutCoordinator.applyRuntimeRolloutUpdate(rollout),
        setAgentModelOverride: async ({ agentId, model }) => this.setAgentModelOverride({ agentId, model }),
        getAgentModelOverride: async ({ agentId }) => this.getAgentModelOverride({ agentId }),
      },
      () => this.ipcBridge.getRealtimeMetrics(),
      async (params) => {
        this.channelRuntime.applyChannelRoutingUpdate(params);
        if (params.adapterConfigs) {
          await this.channelRuntime.updateAdapterConfigs(params.adapterConfigs);
        }
      }
    );

    registerInternalRuntimeHandlers(
      this.rpcHandler,
      this.repository,
      () => this.getInternalRuntimeConfig(),
      () => this.toolRegistry,
      undefined,
      {
        onDryRunComplete: (sample) => this.runtimeRolloutCoordinator.handleDryRunComplete(sample),
      }
    );
  }

  getGatewayStatusSnapshot(): {
    isRunning: boolean;
    daemonAttachment: GatewayDaemonAttachmentStatus;
    daemonDetach: GatewayDaemonDetachStatus;
    daemonConnected: boolean;
    schedulerConnected: boolean;
  } {
    const daemonOperationState = this.daemonAttachment.getOperationState();
    const daemonAttachment = daemonOperationState.attachment.status;
    const schedulerConnected = this.schedulerBridge.isConnected();

    return {
      isRunning: this.getIsRunning(),
      daemonAttachment,
      daemonDetach: daemonOperationState.detach,
      daemonConnected: daemonAttachment.connected,
      schedulerConnected,
    };
  }

  private getInternalRuntimeConfig() {
    const runtime = loadRuntimeConfig();
    return {
      deterministicRuntimeEnabled: runtime.scheduler.deterministicRuntimeEnabled,
      planCompilerEnabled: runtime.scheduler.planCompilerEnabled,
      toolRoutingMode: runtime.scheduler.toolRoutingMode,
      runtimeRollout: runtime.scheduler.runtimeRollout,
      agent: {
        mainAgentId: runtime.agent.mainAgentId,
      },
      tui: {
        inputBackgroundColor: runtime.tui.inputBackgroundColor,
        sessionFirstEnabled: runtime.tui.sessionFirstEnabled,
        goalSubmitFastPathEnabled: runtime.tui.goalSubmitFastPathEnabled,
      },
    };
  }

  private async setAgentModelOverride(params: {
    agentId: string;
    model: string;
  }): Promise<{ success: boolean; agentId: string; model: string; configPath: string }> {
    if (!this.ipcBridge.isSchedulerDaemonConnected()) {
      throw new Error('Scheduler daemon is not connected');
    }

    return this.ipcBridge.setAgentModelOverride(params);
  }

  private async getAgentModelOverride(params: {
    agentId: string;
  }): Promise<{ agentId: string; model: string | null }> {
    if (!this.ipcBridge.isSchedulerDaemonConnected()) {
      const runtime = loadRuntimeConfig();
      const stored = runtime.agent.modelOverrides?.[params.agentId];
      return {
        agentId: params.agentId,
        model: typeof stored === 'string' && stored.trim().length > 0 && stored.trim().toLowerCase() !== 'auto'
          ? stored.trim()
          : null,
      };
    }

    return this.ipcBridge.getAgentModelOverride(params);
  }
}
