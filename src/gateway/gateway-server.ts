/**
 * Gateway Server - Main WebSocket server for client communication
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type Database from 'better-sqlite3';

import type { GatewayConfig, Permission, EventFrame } from './types.js';
import { DEFAULT_GATEWAY_CONFIG } from './types.js';
import { EventBus } from './events/event-bus.js';
import { EventEmitter } from './events/event-emitter.js';
import { BroadcastManager } from './events/broadcast-manager.js';
import { ChannelRouter } from './channels/channel-router.js';
import type { GatewayChannelAdapterStatus } from './channels/channel-adapter.js';
import { GatewayChannelRuntime } from './channels/gateway-channel-runtime.js';
import { ConnectionManager } from './connection/connection-manager.js';
import { AuthManager } from './auth/auth-manager.js';
import { MessageRouter } from './protocol/message-router.js';
import { RpcHandler } from './rpc/rpc-handler.js';
import {
  GatewayDaemonAttachment,
  type GatewayDaemonAttachmentStatus,
  type GatewayDaemonDetachStatus,
} from './integration/gateway-daemon-attachment.js';
import { SchedulerBridge } from './integration/scheduler-bridge.js';
import { IPCBridge } from './integration/ipc-bridge.js';
import type { ISchedulerCore } from '../scheduler/core/index.js';
import type { IDaemonEventEmitter } from '../runtime/events/daemon-event-emitter.js';
import { IPCServer } from '../ipc/ipc-server.js';
import { isPonyBunnyDebugEnabled } from '../infra/config/debug-flags.js';
import { setWsConnectionId, getWsConnectionId } from './connection/ws-metadata.js';
import { isLocalAddress as isLocalAddr } from './utils/network.js';

import { registerGoalHandlers } from './rpc/handlers/goal-handlers.js';
import { registerWorkItemHandlers } from './rpc/handlers/workitem-handlers.js';
import { registerEscalationHandlers } from './rpc/handlers/escalation-handlers.js';
import { registerApprovalHandlers } from './rpc/handlers/approval-handlers.js';
import { registerDebugHandlers } from './rpc/handlers/debug-handlers.js';
import { registerConversationHandlers } from './rpc/handlers/conversation-handlers.js';
import { registerAuditHandlers } from './rpc/handlers/audit-handlers.js';
import { registerEvaluationHandlers } from './rpc/handlers/evaluation-handlers.js';
import { registerPlanReviewHandlers } from './rpc/handlers/plan-review-handlers.js';
import { registerHarnessMetricsHandlers } from './rpc/handlers/harness-metrics-handlers.js';
import { HarnessMetricsService } from '../app/observability/harness-metrics-service.js';
import { GatewayRuntimeRolloutCoordinator } from './runtime/gateway-runtime-rollout-coordinator.js';
import { GatewaySchedulerEventAuditObserver } from './runtime/gateway-scheduler-event-audit-observer.js';
import type { GatewayRuntimeRpcSurface } from './runtime/gateway-runtime-rpc-surface.js';
import type { GatewayToolProviderRuntime } from './runtime/gateway-tool-provider-runtime.js';
import { createGatewayToolProviderRuntimeCluster } from './runtime/gateway-tool-provider-runtime-cluster.js';
import { DebugEventAdapter } from '../runtime/event-bus/adapters/debug-event-adapter.js';
import { GatewayEventAdapter } from '../runtime/event-bus/adapters/gateway-event-adapter.js';
import { SchedulerEventAdapter } from '../runtime/event-bus/adapters/scheduler-event-adapter.js';
import {
  RuntimeEventStore,
  type RuntimeEventStoreBinding,
} from '../runtime/event-bus/runtime-event-store.js';
import {
  resolveDefaultGatewaySchedulerSocketPath,
  startGatewayServerRuntimeLifecycle,
  stopGatewayServerRuntimeLifecycle,
  type GatewayServerRuntimeLifecycleDependencies,
  type GatewayServerRuntimeLifecycleStartResult,
} from './bootstrap/gateway-server-runtime-lifecycle.js';

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import { AuditLogRepository } from '../infra/persistence/audit-repository.js';
import { AuditService } from '../infra/audit/audit-service.js';
import { getConfigDir } from '../infra/config/config-paths.js';

import { ConfigWatcher, createConfigWatcher } from './config/config-watcher.js';
import { loadRuntimeConfig, saveRuntimeConfig } from '../infra/config/runtime-config.js';
import { GatewayLLMStreamEventSink } from './events/llm-stream-event-sink.js';

export interface GatewayServerDependencies {
  db: Database.Database;
  dbPath?: string;
  memoryDb?: Database.Database;
  memoryDbPath?: string;
  repository: IWorkOrderRepository;
  debugMode?: boolean;
  personasDir?: string;
  enableConfigWatch?: boolean;
  schedulerSocketPath?: string;
}

export class GatewayServer {
  private wss?: WebSocketServer;
  private config: GatewayConfig;
  private db: Database.Database;
  private dbPath?: string;
  private memoryDbPath?: string;
  private repository: IWorkOrderRepository;
  private debugMode: boolean;

  // Internal components
  private eventBus: EventBus;
  private connectionManager: ConnectionManager;
  private authManager: AuthManager;
  private rpcHandler: RpcHandler;
  private messageRouter: MessageRouter;
  private eventEmitter: EventEmitter;
  private broadcastManager: BroadcastManager;
  private channelRuntime: GatewayChannelRuntime;
  private channelRouter: ChannelRouter;
  private daemonAttachment: GatewayDaemonAttachment;
  private schedulerBridge: SchedulerBridge;
  private ipcServer: IPCServer;
  private ipcBridge: IPCBridge;
  private debugEventAdapter: DebugEventAdapter;
  private gatewayEventAdapter: GatewayEventAdapter;
  private schedulerEventAdapter: SchedulerEventAdapter;
  private runtimeEventStore: RuntimeEventStore;
  private runtimeEventStoreBinding: RuntimeEventStoreBinding | null = null;
  private runtimeLifecycleState: GatewayServerRuntimeLifecycleStartResult | null = null;
  private scheduler: ISchedulerCore | null = null;
  private debugBroadcasterCleanup: (() => void) | null = null;
  // Audit components
  private auditRepository: AuditLogRepository;
  private auditService: AuditService;

  // Tool components
  private toolProviderRuntime: GatewayToolProviderRuntime;

  private configWatcher?: ConfigWatcher;
  private enableConfigWatch: boolean;

  private isRunning = false;
  private runtimeRolloutCoordinator: GatewayRuntimeRolloutCoordinator;
  private runtimeRpcSurface: GatewayRuntimeRpcSurface;
  private schedulerEventAuditObserver: GatewaySchedulerEventAuditObserver;

  constructor(
    dependencies: GatewayServerDependencies,
    config: Partial<GatewayConfig> = {}
  ) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.db = dependencies.db;
    this.dbPath = dependencies.dbPath;
    this.memoryDbPath = dependencies.memoryDbPath;
    this.repository = dependencies.repository;
    this.debugMode = dependencies.debugMode ?? false;
    this.enableConfigWatch = dependencies.enableConfigWatch ?? false;

    // Initialize components
    this.eventBus = new EventBus();
    this.eventBus.on('connection.authenticated', (sample: unknown) => {
      this.channelRuntime.handleConnectionAuthenticated(sample);
    });
    this.eventBus.on('connection.disconnected', (sample: unknown) => {
      this.channelRuntime.handleConnectionDisconnected(sample);
    });
    this.eventBus.onAny((event, sample) => {
      void this.channelRuntime.captureEvent(event, sample).then((report) => {
        if (!report || report.failed.length === 0) {
          return;
        }

        console.warn(
          `[GatewayServer] Adapter publish had ${report.failed.length} failure(s) for event ${event}: ${report.failed
            .map((failure) => `${failure.channel}=${failure.error}`)
            .join(', ')}`
        );
      });
    });

    this.connectionManager = new ConnectionManager(
      {
        maxConnectionsPerIp: this.config.maxConnectionsPerIp,
        maxLocalConnections: this.config.maxLocalConnections ?? 512,
        heartbeat: {
          intervalMs: this.config.heartbeatIntervalMs,
          timeoutMs: this.config.heartbeatTimeoutMs,
        },
      },
      this.eventBus
    );

    this.authManager = new AuthManager(this.db, {
      challengeTtlMs: this.config.authTimeoutMs,
    });

    this.rpcHandler = new RpcHandler();
    this.messageRouter = new MessageRouter(
      this.connectionManager,
      this.rpcHandler,
      this.authManager
    );

    this.eventEmitter = new EventEmitter(this.connectionManager);
    this.channelRuntime = GatewayChannelRuntime.createDefault({
      repository: this.repository,
      eventBus: this.eventBus,
      configDir: getConfigDir(),
    });
    this.channelRouter = this.channelRuntime.channelRouter;
    this.broadcastManager = new BroadcastManager(this.eventBus, this.eventEmitter, this.channelRouter);
    this.daemonAttachment = new GatewayDaemonAttachment(this.eventBus);
    this.schedulerBridge = new SchedulerBridge(this.eventBus);
    this.debugEventAdapter = new DebugEventAdapter();
    this.gatewayEventAdapter = new GatewayEventAdapter(this.eventBus);
    this.schedulerEventAdapter = new SchedulerEventAdapter();
    this.runtimeEventStore = new RuntimeEventStore(this.db);

    // Initialize IPC server and bridge
    const ipcSocketPath = dependencies.schedulerSocketPath ?? resolveDefaultGatewaySchedulerSocketPath();
    this.ipcServer = new IPCServer({ socketPath: ipcSocketPath });
    this.ipcBridge = new IPCBridge(this.eventBus);
    this.runtimeRolloutCoordinator = new GatewayRuntimeRolloutCoordinator({
      eventBus: this.eventBus,
      repository: this.repository,
      configStore: {
        load: loadRuntimeConfig,
        save: saveRuntimeConfig,
      },
      schedulerTransport: {
        isConnected: () => this.ipcBridge.isSchedulerDaemonConnected(),
        applyRuntimeRollout: async (rollout) => this.ipcBridge.applyRuntimeRollout(rollout),
      },
    });

    // Initialize audit components
    this.auditRepository = new AuditLogRepository(this.db);
    this.auditRepository.initialize();
    this.auditService = new AuditService(this.auditRepository, { asyncMode: true });
    this.schedulerEventAuditObserver = new GatewaySchedulerEventAuditObserver({
      eventBus: this.eventBus,
      auditService: this.auditService,
    });

    // Initialize tool components
    const toolProviderRuntimeCluster = createGatewayToolProviderRuntimeCluster({
      streamEventSink: new GatewayLLMStreamEventSink(),
      rpcHandler: this.rpcHandler,
      repository: this.repository,
      getIsRunning: () => this.isRunning,
      connectionManager: this.connectionManager,
      channelRuntime: this.channelRuntime,
      daemonAttachment: this.daemonAttachment,
      schedulerBridge: this.schedulerBridge,
      getScheduler: () => this.scheduler,
      ipcBridge: this.ipcBridge,
      runtimeRolloutCoordinator: this.runtimeRolloutCoordinator,
    });
    this.toolProviderRuntime = toolProviderRuntimeCluster.toolProviderRuntime;
    this.runtimeRpcSurface = toolProviderRuntimeCluster.runtimeRpcSurface;

    if (this.enableConfigWatch) {
      this.configureConfigWatcher();
    }

    this.registerHandlers();
  }

  private configureConfigWatcher(): void {
    const configDir = getConfigDir();
    this.configWatcher = createConfigWatcher(configDir);

    this.configWatcher.on('change', (event: { path: string; timestamp: number }) => {
      if (isPonyBunnyDebugEnabled()) console.log(`[GatewayServer] Config file changed: ${event.path}`);
      this.eventBus.emit('config.changed', event);
      
      if (this.config.autoRestart) {
        console.log('[GatewayServer] Auto-restart triggered by config change');
        this.restartServer().catch((error: Error) => {
          console.error('[GatewayServer] Auto-restart failed:', error);
        });
      }
    });
  }

  private registerHandlers(): void {
    registerGoalHandlers(
      this.rpcHandler,
      this.repository,
      this.eventBus,
      () => this.scheduler,
      this.auditService,
      this.ipcBridge
    );
    registerWorkItemHandlers(this.rpcHandler, this.repository);
    registerEscalationHandlers(
      this.rpcHandler,
      this.repository as any,
      this.eventBus,
      () => this.scheduler,
      this.ipcBridge
    );
    registerApprovalHandlers(this.rpcHandler, this.eventBus);
    registerDebugHandlers(
      this.rpcHandler,
      this.repository,
      this.eventBus,
      () => this.scheduler,
      () => this.connectionManager
    );

    registerConversationHandlers(this.rpcHandler, this.eventBus, this.ipcBridge);

    registerAuditHandlers(this.rpcHandler, this.auditService, this.auditRepository);

    registerEvaluationHandlers(this.rpcHandler, this.ipcBridge);

    registerPlanReviewHandlers(
      this.rpcHandler,
      this.repository,
      this.ipcBridge,
      this.eventBus,
      this.auditService,
    );

    registerHarnessMetricsHandlers(
      this.rpcHandler,
      new HarnessMetricsService(this.db),
    );

    this.runtimeRpcSurface.register();

    this.rpcHandler.register('system.ping', [], async () => ({ pong: Date.now() }));
    this.rpcHandler.register('system.methods', ['read'], async (_, session) => ({
      methods: this.rpcHandler.listAccessibleMethods(session),
    }));
    this.rpcHandler.register('system.stats', ['admin'], async () => ({
      connections: this.connectionManager.getStats(),
    }));
  }

  /**
   * Start the gateway server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Gateway server is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          host: this.config.host,
          port: this.config.port,
        });

        this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));

        this.wss.on('error', (error) => {
          console.error('[GatewayServer] Server error:', error);
          if (!this.isRunning) {
            reject(error);
          }
        });

        this.wss.on('listening', async () => {
          try {
            this.isRunning = true;
            this.runtimeLifecycleState = await startGatewayServerRuntimeLifecycle(
              this.buildRuntimeLifecycleDependencies()
            );
            this.runtimeEventStoreBinding = this.runtimeLifecycleState.runtimeEventStoreBinding;
            this.debugBroadcasterCleanup = this.runtimeLifecycleState.debugBroadcasterCleanup;

            resolve();
          } catch (error) {
            this.isRunning = false;
            reject(error);
          }
        });
      } catch (error) {
        this.configWatcher?.stop();
        reject(error);
      }
    });
  }

  /**
   * Stop the gateway server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.schedulerEventAdapter.disconnect();
    await stopGatewayServerRuntimeLifecycle(this.buildRuntimeLifecycleDependencies(), this.runtimeLifecycleState);
    this.runtimeLifecycleState = null;
    this.runtimeEventStoreBinding = null;
    this.debugBroadcasterCleanup = null;

    await this.auditService.shutdown();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          console.log('[GatewayServer] Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async restartServer(): Promise<void> {
    console.log('[GatewayServer] Restarting server...');
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.start();
    console.log('[GatewayServer] Server restarted successfully');
  }

  /**
   * Connect to a daemon event emitter for event bridging
   */
  connectDaemon(daemon: IDaemonEventEmitter): void {
    this.daemonAttachment.connect(daemon);
  }

  /**
   * Connect to a SchedulerCore for goal execution
   */
  connectScheduler(scheduler: ISchedulerCore): void {
    this.scheduler = scheduler;
    this.schedulerBridge.connect(scheduler);
    this.schedulerEventAdapter.connect(scheduler);
    console.log('[GatewayServer] Scheduler connected');
  }

  /**
   * Disconnect from the scheduler
   */
  disconnectScheduler(): void {
    this.schedulerBridge.disconnect();
    this.schedulerEventAdapter.disconnect();
    this.scheduler = null;
    console.log('[GatewayServer] Scheduler disconnected');
  }

  /**
   * Get the connected scheduler (if any)
   */
  getScheduler(): ISchedulerCore | null {
    return this.scheduler;
  }

  /**
   * Create a pairing token for client authentication
   */
  createPairingToken(permissions: Permission[], expiresInMs?: number): { token: string; id: string } {
    return this.authManager.createPairingToken(permissions, expiresInMs);
  }

  /**
   * Revoke a pairing token
   */
  revokePairingToken(tokenId: string): boolean {
    return this.authManager.revokePairingToken(tokenId);
  }

  /**
   * List active pairing tokens
   */
  listPairingTokens() {
    return this.authManager.listPairingTokens();
  }

  /**
   * Get server statistics
   */
  getStats() {
    const status = this.getGatewayStatusSnapshot();
    return {
      isRunning: status.isRunning,
      address: this.isRunning ? `ws://${this.config.host}:${this.config.port}` : null,
      connections: this.connectionManager.getStats(),
      daemonConnected: status.daemonAttachment.connected,
      schedulerConnected: status.schedulerConnected,
      debugMode: this.debugMode,
    };
  }

  getChannelAdapterStatuses(): GatewayChannelAdapterStatus[] {
    return this.channelRuntime.getAdapterStatuses();
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * Get the event bus for external event emission
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Get the audit service for external audit logging
   */
  getAuditService(): AuditService {
    return this.auditService;
  }

  private getGatewayStatusSnapshot(): {
    isRunning: boolean;
    daemonAttachment: GatewayDaemonAttachmentStatus;
    daemonDetach: GatewayDaemonDetachStatus;
    daemonConnected: boolean;
    schedulerConnected: boolean;
  } {
    return this.runtimeRpcSurface.getGatewayStatusSnapshot();
  }

  private buildRuntimeLifecycleDependencies(): GatewayServerRuntimeLifecycleDependencies {
    return {
      config: this.config,
      dbPath: this.dbPath,
      memoryDbPath: this.memoryDbPath,
      debugMode: this.debugMode,
      eventBus: this.eventBus,
      connectionManager: this.connectionManager,
      broadcastManager: this.broadcastManager,
      channelRouter: this.channelRouter,
      channelAdapterManager: this.channelRuntime.channelAdapterManager,
      channelAdapterConfigs: this.channelRuntime.getAdapterConfigs(),
      debugEventAdapter: this.debugEventAdapter,
      gatewayEventAdapter: this.gatewayEventAdapter,
      runtimeEventStore: this.runtimeEventStore,
      ipcServer: this.ipcServer,
      ipcBridge: this.ipcBridge,
      configWatcher: this.configWatcher,
      setupSchedulerEventAudit: () => this.schedulerEventAuditObserver.start(),
      teardownSchedulerEventAudit: () => this.schedulerEventAuditObserver.stop(),
    };
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const remoteAddress = req.socket.remoteAddress || 'unknown';

    // Assign connection ID
    setWsConnectionId(ws, `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

    // Check connection limit
    if (!this.connectionManager.canAcceptConnection(remoteAddress)) {
      const stats = this.connectionManager.getConnectionCount(remoteAddress);
      console.log(`[GatewayServer] ❌ Connection limit exceeded for ${remoteAddress} [${stats.current}/${stats.max}]`);
      ws.close(4006, 'Connection limit exceeded');
      return;
    }

    // Check if this is a local connection (auto-authenticate)
    const isLocalConnection = this.isLocalAddress(remoteAddress);

    if (isLocalConnection) {
      // Auto-authenticate local connections with full permissions
      const sessionData = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        publicKey: `local:${remoteAddress}`,
        permissions: ['read', 'write', 'admin'] as Permission[],
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
        metadata: {
          channelType: 'tui',
        },
      };
      this.connectionManager.addPendingConnection(ws, remoteAddress, this.config.authTimeoutMs);
      const session = this.connectionManager.promoteConnection(ws, sessionData);

      // Get connection stats and display
      const stats = this.connectionManager.getConnectionCount(remoteAddress);
      console.log(`[GatewayServer] ✅ Local connection authenticated from ${remoteAddress} [${stats.current}/${stats.max}]`);

      // Send authentication success event to client
      const authEvent: EventFrame = {
        type: 'event',
        event: 'connection.authenticated',
        data: {
          sessionId: session.id,
          permissions: session.permissions,
        },
      };
      ws.send(JSON.stringify(authEvent));
    } else {
      // Add as pending connection (requires authentication)
      this.connectionManager.addPendingConnection(ws, remoteAddress, this.config.authTimeoutMs);
      const stats = this.connectionManager.getConnectionCount(remoteAddress);
      console.log(`[GatewayServer] 🔑 New connection from ${remoteAddress} [${stats.current}/${stats.max}] (auth required)`);
    }

    // Set up message handler
    ws.on('message', async (data) => {
      try {
        await this.messageRouter.handleMessage(ws, data as Buffer);
      } catch (error) {
        console.error('[GatewayServer] Message handling error:', error);
      }
    });

    // Set up close handler
    ws.on('close', (code, reason) => {
      const stats = this.connectionManager.getConnectionCount(remoteAddress);
      console.log(`[GatewayServer] 🔌 Connection closed: ${code} ${reason.toString()} from ${remoteAddress} [${stats.current - 1}/${stats.max}]`);
      this.connectionManager.handleDisconnect(ws);
      this.authManager.cancelAuth(getWsConnectionId(ws) ?? '');
    });

    // Set up error handler
    ws.on('error', (error) => {
      console.error('[GatewayServer] WebSocket error:', error);
    });
  }

  /**
   * Check if an address is a local/loopback address
   */
  private isLocalAddress(address: string): boolean {
    const isLocal = isLocalAddr(address);
    if (isPonyBunnyDebugEnabled()) console.log(`[GatewayServer] isLocalAddress check: "${address}" => ${isLocal}`);
    return isLocal;
  }
}
