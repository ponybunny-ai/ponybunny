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
import { registerConversationHandlers } from './rpc/handlers/conversation-handlers.js';
import { registerPersonaHandlers } from './rpc/handlers/persona-handlers.js';
import { setupDebugBroadcaster } from './debug-broadcaster.js';

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';

// Conversation imports
import { SessionManager, type ISessionManager } from '../app/conversation/session-manager.js';
import { PersonaEngine, type IPersonaEngine } from '../app/conversation/persona-engine.js';
import { InputAnalysisService } from '../app/conversation/input-analysis-service.js';
import { ResponseGenerator } from '../app/conversation/response-generator.js';
import { TaskBridge } from '../app/conversation/task-bridge.js';
import { RetryHandler } from '../app/conversation/retry-handler.js';
import { FilePersonaRepository, InMemoryPersonaRepository } from '../infra/conversation/persona-repository.js';
import { InMemorySessionRepository } from '../infra/conversation/session-repository.js';
import { getLLMService } from '../infra/llm/llm-service.js';
import * as path from 'path';
import * as fs from 'fs';

export interface GatewayServerDependencies {
  db: Database.Database;
  repository: IWorkOrderRepository;
  debugMode?: boolean;
  personasDir?: string;  // Optional custom personas directory
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

  // Conversation components
  private sessionManager: ISessionManager;
  private personaEngine: IPersonaEngine;

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

    // Initialize conversation components
    const { personaEngine, sessionManager } = this.initializeConversation(dependencies.personasDir);
    this.personaEngine = personaEngine;
    this.sessionManager = sessionManager;

    // Register RPC handlers
    this.registerHandlers();
  }

  /**
   * Initialize conversation components with dependency injection
   */
  private initializeConversation(personasDir?: string): {
    personaEngine: IPersonaEngine;
    sessionManager: ISessionManager;
  } {
    // Determine personas directory
    const defaultPersonasDir = path.join(process.cwd(), 'config', 'personas');
    const resolvedPersonasDir = personasDir || defaultPersonasDir;

    // Create persona repository (file-based if directory exists, otherwise in-memory)
    let personaRepository;
    if (fs.existsSync(resolvedPersonasDir)) {
      personaRepository = new FilePersonaRepository(resolvedPersonasDir);
    } else {
      console.log('[GatewayServer] Personas directory not found, using in-memory repository');
      personaRepository = new InMemoryPersonaRepository();
      // Add default persona to in-memory repository
      personaRepository.addPersona({
        id: 'pony-default',
        name: 'Pony',
        nickname: '小马',
        personality: { warmth: 0.8, formality: 0.4, humor: 0.5, empathy: 0.7 },
        communicationStyle: { verbosity: 'balanced', technicalDepth: 'adaptive', expressiveness: 'moderate' },
        expertise: {
          primaryDomains: ['software-engineering', 'devops', 'automation'],
          skillConfidence: { coding: 0.95, debugging: 0.9, architecture: 0.85 },
        },
        backstory: '我是 Pony，你的自主 AI 助手。',
        locale: 'zh-CN',
      });
    }

    const personaEngine = new PersonaEngine(personaRepository);
    const sessionRepository = new InMemorySessionRepository();
    const llmService = getLLMService();

    const inputAnalyzer = new InputAnalysisService(llmService);
    const responseGenerator = new ResponseGenerator(llmService, personaEngine);
    const taskBridge = new TaskBridge(this.repository as any, () => this.scheduler);
    const retryHandler = new RetryHandler(llmService);

    const sessionManager = new SessionManager(
      sessionRepository,
      personaEngine,
      inputAnalyzer,
      responseGenerator,
      taskBridge,
      retryHandler
    );

    return { personaEngine, sessionManager };
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

    // Conversation handlers
    registerConversationHandlers(this.rpcHandler, this.sessionManager, this.eventBus);
    registerPersonaHandlers(this.rpcHandler, this.personaEngine);

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

    // Check if this is a local connection (auto-authenticate)
    const isLocalConnection = this.isLocalAddress(remoteAddress);

    if (isLocalConnection) {
      // Auto-authenticate local connections with full permissions
      console.log(`[GatewayServer] Auto-authenticating local connection from ${remoteAddress}`);
      const sessionData = {
        id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        publicKey: `local:${remoteAddress}`,
        permissions: ['read', 'write', 'admin'] as Permission[],
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
      };
      this.connectionManager.addPendingConnection(ws, remoteAddress, this.config.authTimeoutMs);
      this.connectionManager.promoteConnection(ws, sessionData);
    } else {
      // Add as pending connection (requires authentication)
      this.connectionManager.addPendingConnection(ws, remoteAddress, this.config.authTimeoutMs);
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
      console.log(`[GatewayServer] Connection closed: ${code} ${reason.toString()}`);
      this.connectionManager.handleDisconnect(ws);
      this.authManager.cancelAuth((ws as any)._connectionId);
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
    const isLocal = (
      address === '127.0.0.1' ||
      address === '::1' ||
      address === '::ffff:127.0.0.1' ||
      address === 'localhost' ||
      address.startsWith('::ffff:127.')
    );
    console.log(`[GatewayServer] isLocalAddress check: "${address}" => ${isLocal}`);
    return isLocal;
  }
}
