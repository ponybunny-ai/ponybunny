import { homedir } from 'os';
import { join } from 'path';

import type { GatewayConfig } from '../types.js';
import type { EventBus } from '../events/event-bus.js';
import type { ConnectionManager } from '../connection/connection-manager.js';
import type { BroadcastManager } from '../events/broadcast-manager.js';
import type { ChannelRouter } from '../channels/channel-router.js';
import type { ChannelAdapterManager } from '../channels/channel-adapter-manager.js';
import type { GatewayChannelAdapterConfigMap } from '../channels/channel-adapter-config.js';
import type { DebugEventAdapter } from '../../runtime/event-bus/adapters/debug-event-adapter.js';
import type { GatewayEventAdapter } from '../../runtime/event-bus/adapters/gateway-event-adapter.js';
import type { RuntimeEventStore, RuntimeEventStoreBinding } from '../../runtime/event-bus/runtime-event-store.js';
import { attachRuntimeEventStore } from '../../runtime/event-bus/runtime-event-store.js';
import { runtimeEventBus } from '../../runtime/event-bus/runtime-event-bus.js';
import type { IPCServer } from '../../ipc/ipc-server.js';
import type { IPCBridge } from '../integration/ipc-bridge.js';
import type { ConfigWatcher } from '../config/config-watcher.js';
import { getAsciiArtBanner } from '../../infra/ui/ascii-art-banner.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { setupDebugBroadcaster } from '../debug-broadcaster.js';
import type { ILogger } from '../../infra/observability/logger.js';
import { NoopLogger } from '../../infra/observability/logger.js';

export interface GatewayServerRuntimeLifecycleDependencies {
  config: GatewayConfig;
  dbPath?: string;
  memoryDbPath?: string;
  debugMode: boolean;
  eventBus: EventBus;
  connectionManager: ConnectionManager;
  broadcastManager: BroadcastManager;
  channelRouter: ChannelRouter;
  channelAdapterManager: ChannelAdapterManager;
  channelAdapterConfigs: GatewayChannelAdapterConfigMap;
  debugEventAdapter: DebugEventAdapter;
  gatewayEventAdapter: GatewayEventAdapter;
  runtimeEventStore: RuntimeEventStore;
  ipcServer: IPCServer;
  ipcBridge: IPCBridge;
  configWatcher?: ConfigWatcher;
  setupSchedulerEventAudit: () => void;
  teardownSchedulerEventAudit: () => void;
  logger?: ILogger;
}

export interface GatewayServerRuntimeLifecycleStartResult {
  runtimeEventStoreBinding: RuntimeEventStoreBinding;
  debugBroadcasterCleanup: (() => void) | null;
}

export function resolveDefaultGatewaySchedulerSocketPath(): string {
  const runtimeConfig = loadRuntimeConfig();
  return runtimeConfig.paths.schedulerSocket || join(homedir(), '.ponybunny', 'gateway.sock');
}

export async function startGatewayServerRuntimeLifecycle(
  dependencies: GatewayServerRuntimeLifecycleDependencies
): Promise<GatewayServerRuntimeLifecycleStartResult> {
  const logger = dependencies.logger ?? new NoopLogger();

  dependencies.configWatcher?.start();
  if (dependencies.configWatcher) {
    logger.info({ event: 'config_watcher_initialized' }, 'Config watcher initialized');
  }
  const runtimeEventStoreBinding = attachRuntimeEventStore(runtimeEventBus, dependencies.runtimeEventStore);
  dependencies.debugEventAdapter.start();
  dependencies.gatewayEventAdapter.start();
  await dependencies.channelAdapterManager.applyConfig(dependencies.channelAdapterConfigs);
  await dependencies.channelAdapterManager.applyEnabledChannels(dependencies.channelRouter.getEnabledChannels(), {
    reason: 'startup',
    source: 'gateway-startup',
  });
  dependencies.eventBus.emit('channel.adapter.status.updated', {
    timestamp: Date.now(),
    reason: 'startup',
    source: 'gateway-startup',
    adapters: dependencies.channelAdapterManager.getStatuses(),
  });
  dependencies.connectionManager.start();
  dependencies.broadcastManager.start();
  dependencies.setupSchedulerEventAudit();

  try {
    await dependencies.ipcServer.start();
    logger.info({ event: 'ipc_server_started' }, 'IPC server started');
    dependencies.ipcBridge.connect(dependencies.ipcServer);
  } catch (error) {
    logger.error({ event: 'ipc_server_start_failed' }, 'Failed to start IPC server', error instanceof Error ? error : undefined);
  }

  const debugBroadcasterCleanup = dependencies.debugMode
    ? setupDebugBroadcaster(dependencies.connectionManager, dependencies.debugMode)
    : null;

  logGatewayStartupBanner(logger, dependencies.config, dependencies.debugMode, dependencies.dbPath, dependencies.memoryDbPath);

  return {
    runtimeEventStoreBinding,
    debugBroadcasterCleanup,
  };
}

export async function stopGatewayServerRuntimeLifecycle(
  dependencies: GatewayServerRuntimeLifecycleDependencies,
  state: GatewayServerRuntimeLifecycleStartResult | null
): Promise<void> {
  dependencies.configWatcher?.stop();

  if (state?.debugBroadcasterCleanup) {
    state.debugBroadcasterCleanup();
  }

  dependencies.debugEventAdapter.stop();
  dependencies.gatewayEventAdapter.stop();
  dependencies.ipcBridge.disconnect();
  await dependencies.ipcServer.stop();
  await dependencies.channelAdapterManager.stopAll({
    reason: 'shutdown',
    source: 'gateway-stop',
  });

  if (state?.runtimeEventStoreBinding) {
    await state.runtimeEventStoreBinding.stop();
  }

  dependencies.broadcastManager.stop();
  dependencies.teardownSchedulerEventAudit();
  dependencies.connectionManager.stop();
}

function logGatewayStartupBanner(
  logger: ILogger,
  config: GatewayConfig,
  debugMode: boolean,
  dbPath?: string,
  memoryDbPath?: string
): void {
  const bannerSeparator = '═══════════════════════════════════════════════════════';
  logger.info({ event: 'gateway_startup_banner' }, bannerSeparator);
  const asciiArt = getAsciiArtBanner(bannerSeparator.length);
  if (asciiArt) {
    logger.info({ event: 'gateway_startup_banner' }, asciiArt);
  }
  logger.info({ event: 'gateway_started' }, 'PonyBunny Gateway Server Started');
  logger.info({ event: 'gateway_startup_banner' }, bannerSeparator);
  logger.info({ event: 'gateway_startup_config', host: config.host, port: config.port }, `Address: ws://${config.host}:${config.port}`);
  if (dbPath) {
    logger.info({ event: 'gateway_startup_config', dbPath }, `Database: ${dbPath}`);
  }
  if (memoryDbPath) {
    logger.info({ event: 'gateway_startup_config', memoryDbPath }, `Memory DB: ${memoryDbPath}`);
  }
  logger.info({ event: 'gateway_startup_config' }, 'Connection Limits:');
  logger.info({ event: 'gateway_startup_config', maxLocalConnections: config.maxLocalConnections ?? 512 }, `  Local (127.0.0.1):  ${config.maxLocalConnections ?? 512} connections`);
  logger.info({ event: 'gateway_startup_config', maxConnectionsPerIp: config.maxConnectionsPerIp }, `  Remote:             ${config.maxConnectionsPerIp} connections per IP`);
  logger.info({ event: 'gateway_startup_config', heartbeatIntervalMs: config.heartbeatIntervalMs, heartbeatTimeoutMs: config.heartbeatTimeoutMs }, `Heartbeat: ${config.heartbeatIntervalMs}ms interval, ${config.heartbeatTimeoutMs}ms timeout`);
  logger.info({ event: 'gateway_startup_config', authTimeoutMs: config.authTimeoutMs }, `Auth Timeout: ${config.authTimeoutMs}ms`);
  logger.info({ event: 'gateway_startup_config', tls: config.enableTls }, `TLS: ${config.enableTls ? 'Enabled' : 'Disabled'}`);
  logger.info({ event: 'gateway_startup_config', debugMode }, `Debug Mode: ${debugMode ? 'Enabled' : 'Disabled'}`);
  logger.info({ event: 'gateway_startup_banner' }, `${bannerSeparator}\n`);
}
