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
import { ConnectionManager } from './connection/connection-manager.js';
import { AuthManager } from './auth/auth-manager.js';
import { MessageRouter } from './protocol/message-router.js';
import { RpcHandler } from './rpc/rpc-handler.js';
import { DaemonBridge, type IDaemonEventEmitter } from './integration/daemon-bridge.js';
import { SchedulerBridge } from './integration/scheduler-bridge.js';
import { IPCBridge } from './integration/ipc-bridge.js';
import type { ISchedulerCore } from '../scheduler/core/index.js';
import { IPCServer } from '../ipc/ipc-server.js';
import { homedir } from 'os';
import { join } from 'path';

import { registerGoalHandlers } from './rpc/handlers/goal-handlers.js';
import { registerWorkItemHandlers } from './rpc/handlers/workitem-handlers.js';
import { registerEscalationHandlers } from './rpc/handlers/escalation-handlers.js';
import { registerApprovalHandlers } from './rpc/handlers/approval-handlers.js';
import { registerDebugHandlers } from './rpc/handlers/debug-handlers.js';
import { registerConversationHandlers } from './rpc/handlers/conversation-handlers.js';
import { registerPersonaHandlers } from './rpc/handlers/persona-handlers.js';
import { registerAuditHandlers } from './rpc/handlers/audit-handlers.js';
import { registerSystemHandlers } from './rpc/handlers/system-handlers.js';
import { registerInternalRuntimeHandlers } from './rpc/handlers/internal-runtime-handlers.js';
import { RuntimeRolloutTelemetry } from './runtime/runtime-rollout-telemetry.js';
import { setupDebugBroadcaster } from './debug-broadcaster.js';

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import { AuditLogRepository } from '../infra/persistence/audit-repository.js';
import { AuditService } from '../infra/audit/audit-service.js';
import { getConfigDir } from '../infra/config/config-paths.js';

// Conversation imports
import { SessionManager, type ISessionManager } from '../app/conversation/session-manager.js';
import { PersonaEngine, type IPersonaEngine } from '../app/conversation/persona-engine.js';
import { InputAnalysisService } from '../app/conversation/input-analysis-service.js';
import { ResponseGenerator } from '../app/conversation/response-generator.js';
import { TaskBridge } from '../app/conversation/task-bridge.js';
import { RetryHandler } from '../app/conversation/retry-handler.js';
import { FilePersonaRepository, InMemoryPersonaRepository } from '../infra/conversation/persona-repository.js';
import { InMemorySessionRepository } from '../infra/conversation/session-repository.js';
import { SqliteSessionRepository } from '../infra/persistence/sqlite-session-repository.js';
import { SqliteMemoryRepository } from '../infra/persistence/sqlite-memory-repository.js';
import { ConversationMemoryService } from '../app/conversation/memory-service.js';
import { LocalEmbeddingService } from '../app/conversation/local-embedding-service.js';
import { CoreMemorySummaryService } from '../app/conversation/core-memory-summary-service.js';
import { getLLMService } from '../infra/llm/llm-service.js';
import * as path from 'path';
import * as fs from 'fs';
import { ToolRegistry, ToolAllowlist, ToolEnforcer } from '../infra/tools/tool-registry.js';
import { ToolProvider, setGlobalToolProvider } from '../infra/tools/tool-provider.js';
import { ReadFileTool } from '../infra/tools/implementations/read-file-tool.js';
import { WriteFileTool } from '../infra/tools/implementations/write-file-tool.js';
import { ExecuteCommandTool } from '../infra/tools/implementations/execute-command-tool.js';
import { SearchCodeTool } from '../infra/tools/implementations/search-code-tool.js';
import { WebSearchTool } from '../infra/tools/implementations/web-search-tool.js';
import { findSkillsTool } from '../infra/tools/implementations/find-skills-tool.js';
import { ConfigWatcher, createConfigWatcher } from './config/config-watcher.js';
import { getAsciiArtBanner } from '../infra/ui/ascii-art-banner.js';
import { loadRuntimeConfig, saveRuntimeConfig } from '../infra/config/runtime-config.js';

export interface GatewayServerDependencies {
  db: Database.Database;
  dbPath?: string;
  memoryDb?: Database.Database;
  memoryDbPath?: string;
  repository: IWorkOrderRepository;
  debugMode?: boolean;
  personasDir?: string;
  enableConfigWatch?: boolean;
}

export class GatewayServer {
  private wss?: WebSocketServer;
  private config: GatewayConfig;
  private db: Database.Database;
  private dbPath?: string;
  private memoryDb: Database.Database;
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
  private daemonBridge: DaemonBridge;
  private schedulerBridge: SchedulerBridge;
  private ipcServer: IPCServer;
  private ipcBridge: IPCBridge;
  private scheduler: ISchedulerCore | null = null;
  private debugBroadcasterCleanup: (() => void) | null = null;
  private schedulerEventAuditUnsubscribers: Array<() => void> = [];

  // Audit components
  private auditRepository: AuditLogRepository;
  private auditService: AuditService;

  // Tool components
  private toolRegistry: ToolRegistry;
  private toolAllowlist: ToolAllowlist;
  private toolEnforcer: ToolEnforcer;

  // Conversation components
  private sessionManager: ISessionManager;
  private personaEngine: IPersonaEngine;
  private responseGenerator?: ResponseGenerator;

  private configWatcher?: ConfigWatcher;
  private enableConfigWatch: boolean;

  private isRunning = false;
  private runtimeRolloutTelemetry = new RuntimeRolloutTelemetry();

  constructor(
    dependencies: GatewayServerDependencies,
    config: Partial<GatewayConfig> = {}
  ) {
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.db = dependencies.db;
    this.dbPath = dependencies.dbPath;
    this.memoryDb = dependencies.memoryDb ?? dependencies.db;
    this.memoryDbPath = dependencies.memoryDbPath;
    this.repository = dependencies.repository;
    this.debugMode = dependencies.debugMode ?? false;
    this.enableConfigWatch = dependencies.enableConfigWatch ?? false;

    // Initialize components
    this.eventBus = new EventBus();

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
    this.broadcastManager = new BroadcastManager(this.eventBus, this.eventEmitter);
    this.daemonBridge = new DaemonBridge(this.eventBus);
    this.schedulerBridge = new SchedulerBridge(this.eventBus);

    // Initialize IPC server and bridge
    const runtimeConfig = loadRuntimeConfig();
    const ipcSocketPath = runtimeConfig.paths.schedulerSocket || join(homedir(), '.ponybunny', 'gateway.sock');
    this.ipcServer = new IPCServer({ socketPath: ipcSocketPath });
    this.ipcBridge = new IPCBridge(this.eventBus);
    this.eventBus.on('runtime.retention.run', (sample: unknown) => {
      if (!sample || typeof sample !== 'object') {
        return;
      }

      const payload = sample as {
        deleted?: number;
        ok?: boolean;
        timestamp?: number;
      };
      this.runtimeRolloutTelemetry.recordRetentionRun({
        deleted: typeof payload.deleted === 'number' ? payload.deleted : 0,
        ok: payload.ok === true,
        timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
      });
    });

    // Initialize audit components
    this.auditRepository = new AuditLogRepository(this.db);
    this.auditRepository.initialize();
    this.auditService = new AuditService(this.auditRepository, { asyncMode: true });

    // Initialize tool components
    this.toolRegistry = new ToolRegistry();
    this.toolAllowlist = new ToolAllowlist();
    this.registerTools();
    this.toolEnforcer = new ToolEnforcer(this.toolRegistry, this.toolAllowlist);

    // Wire up ToolProvider with ToolRegistry so LLM sees all registered tools
    const toolProvider = new ToolProvider(this.toolEnforcer);
    setGlobalToolProvider(toolProvider);

    // Initialize conversation components
    const { personaEngine, sessionManager } = this.initializeConversation(dependencies.personasDir);
    this.personaEngine = personaEngine;
    this.sessionManager = sessionManager;

    if (this.enableConfigWatch) {
      this.initializeConfigWatcher();
    }

    this.registerHandlers();
  }

  /**
   * Register built-in tools
   */
  private registerTools(): void {
    this.toolRegistry.register(new ReadFileTool());
    this.toolRegistry.register(new WriteFileTool());
    this.toolRegistry.register(new ExecuteCommandTool());
    this.toolRegistry.register(new SearchCodeTool());
    this.toolRegistry.register(new WebSearchTool());
    this.toolRegistry.register(findSkillsTool);

    // Allow tools by default (safe tools)
    this.toolAllowlist.addTool('read_file');
    this.toolAllowlist.addTool('write_file');
    this.toolAllowlist.addTool('execute_command');
    this.toolAllowlist.addTool('search_code');
    this.toolAllowlist.addTool('web_search');
    this.toolAllowlist.addTool('find_skills');
  }

  /**
   * Initialize conversation components with dependency injection
   */
  private initializeConversation(personasDir?: string): {
    personaEngine: IPersonaEngine;
    sessionManager: ISessionManager;
  } {
    const runtimeConfig = loadRuntimeConfig();

    // Determine personas directory
    const defaultPersonasDir = path.join(process.cwd(), 'config', 'personas');
    const resolvedPersonasDir = personasDir || runtimeConfig.persona.directory || defaultPersonasDir;

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

    const personaEngine = new PersonaEngine(
      personaRepository,
      runtimeConfig.persona.defaultPersonaId,
      runtimeConfig.persona.promptOverrides
    );
    const useSqliteMemoryBackend = runtimeConfig.memory.backend === 'sqlite';
    const sessionRepository = useSqliteMemoryBackend
      ? new SqliteSessionRepository(this.memoryDb)
      : new InMemorySessionRepository();
    if (sessionRepository instanceof SqliteSessionRepository) {
      sessionRepository.initialize();
    }

    const memoryRepository = new SqliteMemoryRepository(this.memoryDb);
    memoryRepository.initialize();
    const embeddingService = new LocalEmbeddingService(runtimeConfig.memory.embeddingProvider);
    const coreSummaryService = new CoreMemorySummaryService(getLLMService());
    const memoryService = new ConversationMemoryService(
      memoryRepository,
      embeddingService,
      5000,
      coreSummaryService
    );
    const llmService = getLLMService();

    const inputAnalyzer = new InputAnalysisService(llmService);

    // Initialize ResponseGenerator with ToolEnforcer for conversation tools
    this.responseGenerator = new ResponseGenerator(llmService, personaEngine, this.toolEnforcer);

    const taskBridge = new TaskBridge(this.repository as any, () => this.scheduler);
    const retryHandler = new RetryHandler(llmService);

    const sessionManager = new SessionManager(
      sessionRepository,
      personaEngine,
      inputAnalyzer,
      this.responseGenerator,
      taskBridge,
      retryHandler,
      memoryService,
      {
        autoSave: runtimeConfig.memory.autoSave,
        vectorWeight: runtimeConfig.memory.vectorWeight,
        keywordWeight: runtimeConfig.memory.keywordWeight,
        defaultUserProfileId: runtimeConfig.memory.userProfileId,
      }
    );

    return { personaEngine, sessionManager };
  }

  private initializeConfigWatcher(): void {
    const configDir = getConfigDir();
    this.configWatcher = createConfigWatcher(configDir);

    this.configWatcher.on('change', (event: { path: string; timestamp: number }) => {
      console.log(`[GatewayServer] Config file changed: ${event.path}`);
      this.eventBus.emit('config.changed', event);
      
      if (this.config.autoRestart) {
        console.log('[GatewayServer] Auto-restart triggered by config change');
        this.restartServer().catch((error: Error) => {
          console.error('[GatewayServer] Auto-restart failed:', error);
        });
      }
    });

    this.configWatcher.start();
    console.log('[GatewayServer] Config watcher initialized');
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

    registerConversationHandlers(this.rpcHandler, this.sessionManager, this.eventBus);
    registerPersonaHandlers(this.rpcHandler, this.personaEngine);

    registerAuditHandlers(this.rpcHandler, this.auditService, this.auditRepository);

    registerSystemHandlers(
      this.rpcHandler,
      () => this.connectionManager,
      () => this.scheduler,
      () => ({
        isRunning: this.isRunning,
        daemonConnected: this.daemonBridge.isConnected(),
        schedulerConnected: this.schedulerBridge.isConnected(),
      }),
      () => this.toolRegistry,
      {
        getRuntimeRolloutMetrics: () => this.runtimeRolloutTelemetry.snapshot(),
        applyRuntimeRollout: async (rollout) => {
          if (!this.ipcBridge.isSchedulerDaemonConnected()) {
            return;
          }

          await this.ipcBridge.applyRuntimeRollout(rollout);
        },
      }
    );

    registerInternalRuntimeHandlers(
      this.rpcHandler,
      this.repository,
      () => {
        const runtime = loadRuntimeConfig();
        return {
          deterministicRuntimeEnabled: runtime.scheduler.deterministicRuntimeEnabled,
          planCompilerEnabled: runtime.scheduler.planCompilerEnabled,
          toolRoutingMode: runtime.scheduler.toolRoutingMode,
          runtimeRollout: runtime.scheduler.runtimeRollout,
        };
      },
      () => this.toolRegistry,
      undefined,
      {
        onDryRunComplete: (sample) => {
          this.runtimeRolloutTelemetry.recordDryRun(sample);
          if (!sample.ok) {
            void this.rollbackRuntimeRolloutOnFailure();
          }
        },
      }
    );

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
          this.isRunning = true;
          this.connectionManager.start();
          this.broadcastManager.start();
          this.setupSchedulerEventAudit();

          // Start IPC server
          this.ipcServer.start()
            .then(() => {
              console.log('[GatewayServer] IPC server started');
              // Connect IPC bridge to route messages
              this.ipcBridge.connect(this.ipcServer);
            })
            .catch((error) => {
              console.error('[GatewayServer] Failed to start IPC server:', error);
            });

          // Start debug broadcaster if debug mode is enabled
          if (this.debugMode) {
            this.debugBroadcasterCleanup = setupDebugBroadcaster(
              this.connectionManager,
              this.debugMode
            );
          }

          // Display startup configuration
          const bannerSeparator = '═══════════════════════════════════════════════════════';
          console.log(bannerSeparator);
          const asciiArt = getAsciiArtBanner(bannerSeparator.length);
          if (asciiArt) {
            console.log(asciiArt);
          }
          console.log('🌐 PonyBunny Gateway Server Started');
          console.log(bannerSeparator);
          console.log(`  Address: ws://${this.config.host}:${this.config.port}`);
          if (this.dbPath) {
            console.log(`  Database: ${this.dbPath}`);
          }
          if (this.memoryDbPath) {
            console.log(`  Memory DB: ${this.memoryDbPath}`);
          }
          console.log(`  Connection Limits:`);
          console.log(`    • Local (127.0.0.1):  ${this.config.maxLocalConnections ?? 512} connections`);
          console.log(`    • Remote:             ${this.config.maxConnectionsPerIp} connections per IP`);
          console.log(`  Heartbeat: ${this.config.heartbeatIntervalMs}ms interval, ${this.config.heartbeatTimeoutMs}ms timeout`);
          console.log(`  Auth Timeout: ${this.config.authTimeoutMs}ms`);
          console.log(`  TLS: ${this.config.enableTls ? 'Enabled' : 'Disabled'}`);
          console.log(`  Debug Mode: ${this.debugMode ? 'Enabled' : 'Disabled'}`);
          console.log(`${bannerSeparator}\n`);

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

    if (this.configWatcher) {
      this.configWatcher.stop();
    }

    if (this.debugBroadcasterCleanup) {
      this.debugBroadcasterCleanup();
      this.debugBroadcasterCleanup = null;
    }

    this.ipcBridge.disconnect();
    await this.ipcServer.stop();

    await this.auditService.shutdown();

    this.broadcastManager.stop();
    this.teardownSchedulerEventAudit();
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

  async restartServer(): Promise<void> {
    console.log('[GatewayServer] Restarting server...');
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    await this.start();
    console.log('[GatewayServer] Server restarted successfully');
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

  /**
   * Get the audit service for external audit logging
   */
  getAuditService(): AuditService {
    return this.auditService;
  }

  private async rollbackRuntimeRolloutOnFailure(): Promise<void> {
    const runtime = loadRuntimeConfig();
    if (!runtime.scheduler.runtimeRollout.rollbackOnFailure) {
      return;
    }

    if (
      runtime.scheduler.deterministicRuntimeEnabled === false
      && runtime.scheduler.planCompilerEnabled === false
      && runtime.scheduler.toolRoutingMode === 'legacy'
      && runtime.scheduler.runtimeRollout.shadowModeEnabled === false
      && runtime.scheduler.runtimeRollout.canaryPercent === 0
      && runtime.scheduler.runtimeRollout.lanePercents.dryRun === 0
      && runtime.scheduler.runtimeRollout.lanePercents.compile === 0
      && runtime.scheduler.runtimeRollout.lanePercents.replay === 0
    ) {
      return;
    }

    runtime.scheduler.deterministicRuntimeEnabled = false;
    runtime.scheduler.planCompilerEnabled = false;
    runtime.scheduler.toolRoutingMode = 'legacy';
    runtime.scheduler.runtimeRollout.shadowModeEnabled = false;
    runtime.scheduler.runtimeRollout.canaryPercent = 0;
    runtime.scheduler.runtimeRollout.lanePercents = {
      dryRun: 0,
      compile: 0,
      replay: 0,
    };
    saveRuntimeConfig(runtime);

    if (!this.ipcBridge.isSchedulerDaemonConnected()) {
      return;
    }

    try {
      await this.ipcBridge.applyRuntimeRollout({
        deterministicRuntimeEnabled: runtime.scheduler.deterministicRuntimeEnabled,
        planCompilerEnabled: runtime.scheduler.planCompilerEnabled,
        toolRoutingMode: runtime.scheduler.toolRoutingMode,
        runtimeRollout: {
          shadowModeEnabled: runtime.scheduler.runtimeRollout.shadowModeEnabled,
          canaryPercent: runtime.scheduler.runtimeRollout.canaryPercent,
          rollbackOnFailure: runtime.scheduler.runtimeRollout.rollbackOnFailure,
          lanePercents: {
            dryRun: runtime.scheduler.runtimeRollout.lanePercents.dryRun,
            compile: runtime.scheduler.runtimeRollout.lanePercents.compile,
            replay: runtime.scheduler.runtimeRollout.lanePercents.replay,
          },
        },
      });
    } catch (error) {
      console.error('[GatewayServer] Failed to apply rollback rollout to scheduler daemon:', error);
    }
  }

  private setupSchedulerEventAudit(): void {
    const schedulerEvents = [
      'goal.started',
      'goal.completed',
      'goal.failed',
      'workitem.started',
      'workitem.in_progress',
      'workitem.ended',
      'workitem.completed',
      'workitem.failed',
      'run.started',
      'run.completed',
      'verification.started',
      'verification.completed',
      'escalation.created',
      'escalation.resolved',
      'budget.warning',
      'budget.exceeded',
    ] as const;

    for (const event of schedulerEvents) {
      const unsubscribe = this.eventBus.on(event, (data: unknown) => {
        if (typeof data === 'object' && data !== null) {
          this.auditService.logSchedulerEvent(event, data as Record<string, unknown>);
        }
      });
      this.schedulerEventAuditUnsubscribers.push(unsubscribe);
    }
  }

  private teardownSchedulerEventAudit(): void {
    for (const unsubscribe of this.schedulerEventAuditUnsubscribers) {
      unsubscribe();
    }
    this.schedulerEventAuditUnsubscribers = [];
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const remoteAddress = req.socket.remoteAddress || 'unknown';

    // Assign connection ID
    (ws as any)._connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
