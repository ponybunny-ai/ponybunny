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
  dependencies.configWatcher?.start();
  if (dependencies.configWatcher) {
    console.log('[GatewayServer] Config watcher initialized');
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
    console.log('[GatewayServer] IPC server started');
    dependencies.ipcBridge.connect(dependencies.ipcServer);
  } catch (error) {
    console.error('[GatewayServer] Failed to start IPC server:', error);
  }

  const debugBroadcasterCleanup = dependencies.debugMode
    ? setupDebugBroadcaster(dependencies.connectionManager, dependencies.debugMode)
    : null;

  logGatewayStartupBanner(dependencies.config, dependencies.debugMode, dependencies.dbPath, dependencies.memoryDbPath);

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
  config: GatewayConfig,
  debugMode: boolean,
  dbPath?: string,
  memoryDbPath?: string
): void {
  const bannerSeparator = '═══════════════════════════════════════════════════════';
  console.log(bannerSeparator);
  const asciiArt = getAsciiArtBanner(bannerSeparator.length);
  if (asciiArt) {
    console.log(asciiArt);
  }
  console.log('🌐 PonyBunny Gateway Server Started');
  console.log(bannerSeparator);
  console.log(`  Address: ws://${config.host}:${config.port}`);
  if (dbPath) {
    console.log(`  Database: ${dbPath}`);
  }
  if (memoryDbPath) {
    console.log(`  Memory DB: ${memoryDbPath}`);
  }
  console.log('  Connection Limits:');
  console.log(`    • Local (127.0.0.1):  ${config.maxLocalConnections ?? 512} connections`);
  console.log(`    • Remote:             ${config.maxConnectionsPerIp} connections per IP`);
  console.log(`  Heartbeat: ${config.heartbeatIntervalMs}ms interval, ${config.heartbeatTimeoutMs}ms timeout`);
  console.log(`  Auth Timeout: ${config.authTimeoutMs}ms`);
  console.log(`  TLS: ${config.enableTls ? 'Enabled' : 'Disabled'}`);
  console.log(`  Debug Mode: ${debugMode ? 'Enabled' : 'Disabled'}`);
  console.log(`${bannerSeparator}\n`);
}
