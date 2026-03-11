import {
  GatewayRuntimeRpcSurface,
  type GatewayRuntimeRpcSurfaceDependencies,
} from './gateway-runtime-rpc-surface.js';
import {
  GatewayToolProviderRuntime,
  type GatewayToolProviderRuntimeDependencies,
} from './gateway-tool-provider-runtime.js';

export interface GatewayToolProviderRuntimeClusterDependencies
  extends Omit<GatewayRuntimeRpcSurfaceDependencies, 'toolRegistry'>,
    GatewayToolProviderRuntimeDependencies {}

export interface GatewayToolProviderRuntimeCluster {
  toolProviderRuntime: GatewayToolProviderRuntime;
  runtimeRpcSurface: GatewayRuntimeRpcSurface;
}

export function createGatewayToolProviderRuntimeCluster(
  dependencies: GatewayToolProviderRuntimeClusterDependencies
): GatewayToolProviderRuntimeCluster {
  const toolProviderRuntime = new GatewayToolProviderRuntime({
    streamEventSink: dependencies.streamEventSink,
  });

  const runtimeRpcSurface = new GatewayRuntimeRpcSurface({
    rpcHandler: dependencies.rpcHandler,
    repository: dependencies.repository,
    getIsRunning: dependencies.getIsRunning,
    connectionManager: dependencies.connectionManager,
    channelRuntime: dependencies.channelRuntime,
    daemonAttachment: dependencies.daemonAttachment,
    schedulerBridge: dependencies.schedulerBridge,
    getScheduler: dependencies.getScheduler,
    ipcBridge: dependencies.ipcBridge,
    runtimeRolloutCoordinator: dependencies.runtimeRolloutCoordinator,
    // Publish only the registry facet needed by runtime/control handlers.
    toolRegistry: toolProviderRuntime.toolRegistry,
  });

  return {
    toolProviderRuntime,
    runtimeRpcSurface,
  };
}
