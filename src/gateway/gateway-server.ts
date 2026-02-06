/**
 * Gateway Server - Main WebSocket server for client communication
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type Database from 'better-sqlite3';

import type { GatewayConfig, Permission } from './types.js';
import { DEFAULT_GATEWAY_CONFIG } from './types.js';
import { EventBus } from './events/event-bus.js';
import { EventEmitter } from './events/event-emitter.js';
import { BroadcastManager } from './events/broadcast-manager.js';
import { ConnectionManager } from './connection/connection-manager.js';
import { AuthManager } from './auth/auth-manager.js';
import { MessageRouter } from './protocol/message-router.js';
import { RpcHandler } from './rpc/rpc-handler.js';
import { DaemonBridge, type IDaemonEventEmitter } from './integration/daemon-bridge.js';
import { SchedulerBridge } from './integration/scheduler-bridge.js';
import type { ISchedulerCore } from '../scheduler/core/index.js';

import { registerGoalHandlers } from './rpc/handlers/goal-handlers.js';
import { registerWorkItemHandlers } from './rpc/handlers/workitem-handlers.js';
import { registerEscalationHandlers } from './rpc/handlers/escalation-handlers.js';
import { registerApprovalHandlers } from './rpc/handlers/approval-handlers.js';
import { registerDebugHandlers } from './rpc/handlers/debug-handlers.js';
import { setupDebugBroadcaster } from './debug-broadcaster.js';

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';

export interface GatewayServerDependencies {
  db: Database.Database;
  repository: IWorkOrderRepository;
  debugMode?: boolean;
}

export class GatewayServer {
  private wss?: WebSocketServer;
  private config: GatewayConfig;
  private db: Database.Database;
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
  private daemonBridge: DaemonBridge;
  private schedulerBridge: SchedulerBridge;
  private scheduler: ISchedulerCore | null = null;
  private debugBroadcasterCleanup: (() => void) | null = null;

  private isRunning = false;

  constructor(
    dependencies: GatewayServerDependencies,
    config: Partial<GatewayConfig> = {}
  ) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.db = dependencies.db;
    this.repository = dependencies.repository;
    this.debugMode = dependencies.debugMode ?? false;

    // Initialize components
    this.eventBus = new EventBus();

    this.connectionManager = new ConnectionManager(
      {
        maxConnectionsPerIp: this.config.maxConnectionsPerIp,
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
    this.broadcastManager = new BroadcastManager(this.eventBus, this.eventEmitter);
    this.daemonBridge = new DaemonBridge(this.eventBus);
    this.schedulerBridge = new SchedulerBridge(this.eventBus);

    // Register RPC handlers
    this.registerHandlers();
  }

  private registerHandlers(): void {
    registerGoalHandlers(this.rpcHandler, this.repository, this.eventBus, () => this.scheduler);
    registerWorkItemHandlers(this.rpcHandler, this.repository);
    registerEscalationHandlers(this.rpcHandler, this.repository as any, this.eventBus);
    registerApprovalHandlers(this.rpcHandler, this.eventBus);
    registerDebugHandlers(
      this.rpcHandler,
      this.repository,
      this.eventBus,
      () => this.scheduler,
      () => this.connectionManager
    );

    // System methods
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

        this.wss.on('listening', () => {
          this.isRunning = true;
          this.connectionManager.start();
          this.broadcastManager.start();

          // Start debug broadcaster if debug mode is enabled
          if (this.debugMode) {
            this.debugBroadcasterCleanup = setupDebugBroadcaster(
              this.connectionManager,
              this.debugMode
            );
          }

          console.log(`[GatewayServer] Listening on ws://${this.config.host}:${this.config.port}`);
          resolve();
        });
      } catch (error) {
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

    // Stop debug broadcaster
    if (this.debugBroadcasterCleanup) {
      this.debugBroadcasterCleanup();
      this.debugBroadcasterCleanup = null;
    }

    this.broadcastManager.stop();
    this.connectionManager.stop();

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

  /**
   * Connect to an AutonomyDaemon for event bridging
   */
  connectDaemon(daemon: IDaemonEventEmitter): void {
    this.daemonBridge.connect(daemon);
  }

  /**
   * Connect to a SchedulerCore for goal execution
   */
  connectScheduler(scheduler: ISchedulerCore): void {
    this.scheduler = scheduler;
    this.schedulerBridge.connect(scheduler);
    console.log('[GatewayServer] Scheduler connected');
  }

  /**
   * Disconnect from the scheduler
   */
  disconnectScheduler(): void {
    this.schedulerBridge.disconnect();
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
    return {
      isRunning: this.isRunning,
      address: this.isRunning ? `ws://${this.config.host}:${this.config.port}` : null,
      connections: this.connectionManager.getStats(),
      daemonConnected: this.daemonBridge.isConnected(),
      schedulerConnected: this.schedulerBridge.isConnected(),
      debugMode: this.debugMode,
    };
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

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const remoteAddress = req.socket.remoteAddress || 'unknown';

    // Assign connection ID
    (ws as any)._connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    console.log(`[GatewayServer] New connection from ${remoteAddress}`);

    // Check connection limit
    if (!this.connectionManager.canAcceptConnection(remoteAddress)) {
      console.log(`[GatewayServer] Connection limit exceeded for ${remoteAddress}`);
      ws.close(4006, 'Connection limit exceeded');
      return;
    }

    // Add as pending connection (requires authentication)
    this.connectionManager.addPendingConnection(ws, remoteAddress, this.config.authTimeoutMs);

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
      console.log(`[GatewayServer] Connection closed: ${code} ${reason.toString()}`);
      this.connectionManager.handleDisconnect(ws);
      this.authManager.cancelAuth((ws as any)._connectionId);
    });

    // Set up error handler
    ws.on('error', (error) => {
      console.error('[GatewayServer] WebSocket error:', error);
    });
  }
}
