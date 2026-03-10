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
import { ChannelRouter, type GatewayChannelType } from './channels/channel-router.js';
import { ChannelSessionStore } from './channels/channel-session-store.js';
import { ChannelEventStore, type StoredChannelEvent } from './channels/channel-event-store.js';
import { ChannelEventEnricher } from './channels/channel-event-enricher.js';
import { ChannelAdapterManager } from './channels/channel-adapter-manager.js';
import {
  EmailChannelAdapter,
  WebuiChannelAdapter,
  DiscordChannelAdapter,
  TelegramChannelAdapter,
  WhatsappChannelAdapter,
  type GatewayChannelAdapterStatus,
} from './channels/channel-adapter.js';
import { ChannelAdapterConfigStore } from './channels/channel-adapter-config-store.js';
import {
  type GatewayChannelAdapterConfig,
  type GatewayChannelAdapterConfigMap,
  sanitizeAdapterConfigMap,
  diffAdapterConfigMaps,
  summarizeAdapterConfigImpact,
  normalizeAdapterConfig,
} from './channels/channel-adapter-config.js';
import { ConnectionManager } from './connection/connection-manager.js';
import { AuthManager } from './auth/auth-manager.js';
import { MessageRouter } from './protocol/message-router.js';
import { RpcHandler } from './rpc/rpc-handler.js';
import { GatewayDaemonAttachment } from './integration/gateway-daemon-attachment.js';
import { SchedulerBridge } from './integration/scheduler-bridge.js';
import { IPCBridge } from './integration/ipc-bridge.js';
import type { ISchedulerCore } from '../scheduler/core/index.js';
import type { IDaemonEventEmitter } from '../autonomy/daemon-event-emitter.js';
import { IPCServer } from '../ipc/ipc-server.js';
import { homedir } from 'os';
import { join } from 'path';

import { registerGoalHandlers } from './rpc/handlers/goal-handlers.js';
import { registerWorkItemHandlers } from './rpc/handlers/workitem-handlers.js';
import { registerEscalationHandlers } from './rpc/handlers/escalation-handlers.js';
import { registerApprovalHandlers } from './rpc/handlers/approval-handlers.js';
import { registerDebugHandlers } from './rpc/handlers/debug-handlers.js';
import { registerConversationHandlers } from './rpc/handlers/conversation-handlers.js';
import { registerAuditHandlers } from './rpc/handlers/audit-handlers.js';
import { registerSystemHandlers } from './rpc/handlers/system-handlers.js';
import { registerInternalRuntimeHandlers } from './rpc/handlers/internal-runtime-handlers.js';
import { RuntimeRolloutTelemetry } from './runtime/runtime-rollout-telemetry.js';
import { setupDebugBroadcaster } from './debug-broadcaster.js';
import { DebugEventAdapter } from '../runtime/event-bus/adapters/debug-event-adapter.js';
import { GatewayEventAdapter } from '../runtime/event-bus/adapters/gateway-event-adapter.js';
import { SchedulerEventAdapter } from '../runtime/event-bus/adapters/scheduler-event-adapter.js';
import {
  attachRuntimeEventStore,
  RuntimeEventStore,
  type RuntimeEventStoreBinding,
} from '../runtime/event-bus/runtime-event-store.js';
import { runtimeEventBus } from '../runtime/event-bus/runtime-event-bus.js';

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import { AuditLogRepository } from '../infra/persistence/audit-repository.js';
import { AuditService } from '../infra/audit/audit-service.js';
import { getConfigDir } from '../infra/config/config-paths.js';

// Conversation imports
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
import { configureLLMProviderManagerStreamEventSink } from '../infra/llm/provider-manager/index.js';
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
}

export class GatewayServer {
  private static readonly CHANNEL_EVENT_PREFIXES = [
    'conversation.',
    'goal.',
    'workitem.',
    'run.',
    'verification.',
    'escalation.',
    'budget.',
    'channel.adapter.',
  ] as const;

  private static readonly ADAPTER_DELIVERY_EVENTS = new Set<string>([
    'conversation.response',
    'goal.completed',
    'goal.failed',
    'run.completed',
    'verification.completed',
    'escalation.created',
    'escalation.resolved',
  ]);

  private static readonly ROLLOUT_THRESHOLD_MIN_CONVERSATION_MESSAGES = 10;
  private static readonly ROLLOUT_THRESHOLD_MIN_RUNS = 10;
  private static readonly ROLLOUT_THRESHOLD_MIN_GOALS = 5;
  private static readonly ROLLOUT_THRESHOLD_CONVERSATION_SUCCESS_RATE = 0.8;
  private static readonly ROLLOUT_THRESHOLD_RUN_SUCCESS_RATE = 0.75;
  private static readonly ROLLOUT_THRESHOLD_GOAL_SESSION_COVERAGE = 0.9;

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
  private channelRouter: ChannelRouter;
  private channelSessionStore: ChannelSessionStore;
  private channelEventStore: ChannelEventStore;
  private channelEventEnricher: ChannelEventEnricher;
  private channelAdapterManager: ChannelAdapterManager;
  private channelAdapterConfigStore: ChannelAdapterConfigStore;
  private channelAdapterConfigs: GatewayChannelAdapterConfigMap = {};
  private storedChannelEvents: StoredChannelEvent[] = [];
  private daemonAttachment: GatewayDaemonAttachment;
  private schedulerBridge: SchedulerBridge;
  private ipcServer: IPCServer;
  private ipcBridge: IPCBridge;
  private debugEventAdapter: DebugEventAdapter;
  private gatewayEventAdapter: GatewayEventAdapter;
  private schedulerEventAdapter: SchedulerEventAdapter;
  private runtimeEventStore: RuntimeEventStore;
  private runtimeEventStoreBinding: RuntimeEventStoreBinding | null = null;
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
    this.memoryDbPath = dependencies.memoryDbPath;
    this.repository = dependencies.repository;
    this.channelEventEnricher = new ChannelEventEnricher(this.repository);
    this.debugMode = dependencies.debugMode ?? false;
    this.enableConfigWatch = dependencies.enableConfigWatch ?? false;

    // Initialize components
    this.eventBus = new EventBus();
    this.eventBus.on('conversation.new', (sample: unknown) => {
      const payload = sample as { timestamp?: number } | undefined;
      this.runtimeRolloutTelemetry.recordSessionCreation({
        ok: true,
        timestamp: typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now(),
      });
    });
    this.eventBus.on('conversation.new.failed', (sample: unknown) => {
      const payload = sample as { timestamp?: number } | undefined;
      this.runtimeRolloutTelemetry.recordSessionCreation({
        ok: false,
        timestamp: typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now(),
      });
    });
    this.eventBus.on('conversation.message.succeeded', (sample: unknown) => {
      const payload = sample as { timestamp?: number } | undefined;
      this.runtimeRolloutTelemetry.recordConversationMessage({
        ok: true,
        timestamp: typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now(),
      });
      void this.evaluateRolloutThresholds();
    });
    this.eventBus.on('conversation.message.failed', (sample: unknown) => {
      const payload = sample as { timestamp?: number } | undefined;
      this.runtimeRolloutTelemetry.recordConversationMessage({
        ok: false,
        timestamp: typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now(),
      });
      void this.evaluateRolloutThresholds();
    });
    this.eventBus.on('run.started', (sample: unknown) => {
      const payload = sample as { runId?: string; timestamp?: number } | undefined;
      if (typeof payload?.runId !== 'string' || payload.runId.length === 0) {
        return;
      }

      this.runtimeRolloutTelemetry.recordRunStarted({
        runId: payload.runId,
        timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
      });
    });
    this.eventBus.on('run.completed', (sample: unknown) => {
      const payload = sample as {
        runId?: string;
        success?: boolean;
        status?: string;
        timestamp?: number;
        time_seconds?: number;
      } | undefined;

      this.runtimeRolloutTelemetry.recordRunCompleted({
        runId: payload?.runId,
        success: payload?.success,
        status: payload?.status,
        timestamp: typeof payload?.timestamp === 'number' ? payload.timestamp : Date.now(),
        timeSeconds: typeof payload?.time_seconds === 'number' ? payload.time_seconds : undefined,
      });
      void this.evaluateRolloutThresholds();
    });
    this.eventBus.on('goal.created', () => {
      void this.evaluateRolloutThresholds();
    });
    this.eventBus.on('connection.authenticated', (sample: unknown) => {
      if (!sample || typeof sample !== 'object') {
        return;
      }

      const payload = sample as {
        sessionId?: string;
        metadata?: Record<string, unknown>;
      };

      if (typeof payload.sessionId !== 'string') {
        return;
      }

      const metadata = payload.metadata;
      if (!metadata || typeof metadata.channelType !== 'string') {
        return;
      }

      const channelType = metadata.channelType;
      if (
        channelType === 'tui'
        || channelType === 'webui'
        || channelType === 'email'
        || channelType === 'telegram'
        || channelType === 'whatsapp'
        || channelType === 'discord'
      ) {
        this.channelRouter.setSessionChannel(payload.sessionId, channelType);
        this.channelSessionStore.save(this.channelRouter.getSessionChannelOverrides());
      }
    });
    this.eventBus.on('connection.disconnected', (sample: unknown) => {
      if (!sample || typeof sample !== 'object') {
        return;
      }

      const payload = sample as {
        sessionId?: string;
      };

      if (typeof payload.sessionId === 'string') {
        this.channelRouter.clearSessionChannel(payload.sessionId);
        this.channelSessionStore.save(this.channelRouter.getSessionChannelOverrides());
      }
    });
    this.eventBus.onAny((event, sample) => {
      if (!this.shouldStoreChannelEvent(event)) {
        return;
      }
      if (!sample || typeof sample !== 'object') {
        return;
      }

      const payload = sample as Record<string, unknown>;
      const timestamp = typeof payload.timestamp === 'number' ? payload.timestamp : Date.now();
      const goalId = typeof payload.goalId === 'string' ? payload.goalId : undefined;
      const workItemId = typeof payload.workItemId === 'string' ? payload.workItemId : undefined;
      const runId = typeof payload.runId === 'string' ? payload.runId : undefined;
      const goalContext = this.channelEventEnricher.resolveFromDomainIds(goalId, workItemId, runId);
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : goalContext.sessionId;
      const channelSessionId = typeof payload.channelSessionId === 'string'
        ? payload.channelSessionId
        : goalContext.channelSessionId;
      const gatewaySessionId = typeof payload.gatewaySessionId === 'string' ? payload.gatewaySessionId : undefined;
      const metadata = payload.metadata;
      const metadataChannelType = (
        metadata
        && typeof metadata === 'object'
        && typeof (metadata as Record<string, unknown>).channelType === 'string'
      )
        ? (metadata as Record<string, unknown>).channelType
        : undefined;
      const channelType = this.resolveChannelType(
        payload,
        gatewaySessionId,
        sessionId,
        metadataChannelType,
        goalContext.channelType
      );

      this.storedChannelEvents.push({
        id: `${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
        event,
        timestamp,
        channelType,
        channelSessionId,
        sessionId,
        goalId,
        workItemId,
        runId,
        payload,
      });

      if (this.storedChannelEvents.length > 2000) {
        this.storedChannelEvents = this.storedChannelEvents.slice(-2000);
      }

      this.channelEventStore.save(this.storedChannelEvents);

      if (GatewayServer.ADAPTER_DELIVERY_EVENTS.has(event)) {
        const channels = this.resolveAdapterDeliveryChannels(channelType);
        if (channels.length > 0) {
          void this.channelAdapterManager.publishToChannels(channels, event, payload).then((report) => {
            if (report.failed.length > 0) {
              console.warn(
                `[GatewayServer] Adapter publish had ${report.failed.length} failure(s) for event ${event}: ${report.failed
                  .map((failure) => `${failure.channel}=${failure.error}`)
                  .join(', ')}`
              );
            }
          });
        }
      }
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
    this.channelRouter = new ChannelRouter();
    this.channelAdapterManager = new ChannelAdapterManager([
      new WebuiChannelAdapter(),
      new EmailChannelAdapter(),
      new TelegramChannelAdapter(),
      new WhatsappChannelAdapter(),
      new DiscordChannelAdapter(),
    ]);
    const channelAdapterConfigStorePath = join(getConfigDir(), 'gateway', 'channel-adapter-configs.json');
    this.channelAdapterConfigStore = new ChannelAdapterConfigStore(channelAdapterConfigStorePath);
    this.channelAdapterConfigs = this.channelAdapterConfigStore.load();
    const channelSessionStorePath = join(getConfigDir(), 'gateway', 'channel-sessions.json');
    this.channelSessionStore = new ChannelSessionStore(channelSessionStorePath);
    this.channelRouter.setSessionChannelOverrides(this.channelSessionStore.load());
    const channelEventStorePath = join(getConfigDir(), 'gateway', 'channel-events.json');
    this.channelEventStore = new ChannelEventStore(channelEventStorePath);
    this.storedChannelEvents = this.channelEventStore.load();
    this.broadcastManager = new BroadcastManager(this.eventBus, this.eventEmitter, this.channelRouter);
    this.daemonAttachment = new GatewayDaemonAttachment(this.eventBus);
    this.schedulerBridge = new SchedulerBridge(this.eventBus);
    this.debugEventAdapter = new DebugEventAdapter();
    this.gatewayEventAdapter = new GatewayEventAdapter(this.eventBus);
    this.schedulerEventAdapter = new SchedulerEventAdapter();
    this.runtimeEventStore = new RuntimeEventStore(this.db);

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
    configureLLMProviderManagerStreamEventSink(new GatewayLLMStreamEventSink());

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

    registerConversationHandlers(this.rpcHandler, this.eventBus, this.ipcBridge);

    registerAuditHandlers(this.rpcHandler, this.auditService, this.auditRepository);

    registerSystemHandlers(
      this.rpcHandler,
      () => this.connectionManager,
      () => this.scheduler,
      () => this.channelRouter,
      () => this.storedChannelEvents,
      () => ({
        isRunning: this.isRunning,
        daemonConnected: this.daemonAttachment.isConnected(),
        schedulerConnected: this.schedulerBridge.isConnected(),
      }),
      () => this.channelAdapterManager.getStatuses(),
      async (configs) => {
        const previousConfigs = { ...this.channelAdapterConfigs };
        const mergedConfigs: GatewayChannelAdapterConfigMap = {
          ...this.channelAdapterConfigs,
        };
        for (const [channel, config] of Object.entries(configs)) {
          const typedChannel = channel as GatewayChannelType;
          const previous = mergedConfigs[typedChannel] ?? {};
          mergedConfigs[typedChannel] = normalizeAdapterConfig(typedChannel, {
            ...(previous as GatewayChannelAdapterConfig),
            ...((config ?? {}) as GatewayChannelAdapterConfig),
          });
        }

        await this.channelAdapterManager.applyConfig(mergedConfigs);
        this.channelAdapterConfigs = mergedConfigs;
        this.channelAdapterConfigStore.save(this.channelAdapterConfigs);

        const sanitizedBefore = sanitizeAdapterConfigMap(previousConfigs);
        const sanitizedAfter = sanitizeAdapterConfigMap(this.channelAdapterConfigs);
        const diff = diffAdapterConfigMaps(sanitizedBefore, sanitizedAfter);
        const impactSummary = summarizeAdapterConfigImpact(diff);
        this.eventBus.emit('channel.adapter.config.updated', {
          timestamp: Date.now(),
          reason: 'rpc-update',
          source: 'rpc-system.channels.update',
          configs: sanitizedAfter,
          diff,
          impactSummary,
        });
        this.eventBus.emit('channel.adapter.status.updated', {
          timestamp: Date.now(),
          reason: 'rpc-update',
          source: 'rpc-system.channels.update',
          adapters: this.channelAdapterManager.getStatuses(),
        });
      },
      async () => {
        await this.channelAdapterManager.applyEnabledChannels(this.channelRouter.getEnabledChannels(), {
          reason: 'channel-toggle',
          source: 'channel-router',
        });
        this.eventBus.emit('channel.adapter.status.updated', {
          timestamp: Date.now(),
          reason: 'channel-toggle',
          source: 'channel-router',
          adapters: this.channelAdapterManager.getStatuses(),
        });
      },
      () => this.toolRegistry,
      {
        getRuntimeRolloutMetrics: () => this.runtimeRolloutTelemetry.snapshot(),
        getSessionGoalCoverage: () => this.collectSessionGoalCoverage(),
        applyRuntimeRollout: async (rollout) => {
          if (!this.ipcBridge.isSchedulerDaemonConnected()) {
            return;
          }

          await this.ipcBridge.applyRuntimeRollout(rollout);
        },
        setAgentModelOverride: async ({ agentId, model }) => {
          if (!this.ipcBridge.isSchedulerDaemonConnected()) {
            throw new Error('Scheduler daemon is not connected');
          }
          return this.ipcBridge.setAgentModelOverride({ agentId, model });
        },
        getAgentModelOverride: async ({ agentId }) => {
          if (!this.ipcBridge.isSchedulerDaemonConnected()) {
            const runtime = loadRuntimeConfig();
            const stored = runtime.agent.modelOverrides?.[agentId];
            return {
              agentId,
              model: typeof stored === 'string' && stored.trim().length > 0 && stored.trim().toLowerCase() !== 'auto'
                ? stored.trim()
                : null,
            };
          }
          return this.ipcBridge.getAgentModelOverride({ agentId });
        },
      },
      () => this.ipcBridge.getRealtimeMetrics()
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
          agent: {
            mainAgentId: runtime.agent.mainAgentId,
          },
          tui: {
            inputBackgroundColor: runtime.tui.inputBackgroundColor,
            sessionFirstEnabled: runtime.tui.sessionFirstEnabled,
            goalSubmitFastPathEnabled: runtime.tui.goalSubmitFastPathEnabled,
          },
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
          this.runtimeEventStoreBinding = attachRuntimeEventStore(runtimeEventBus, this.runtimeEventStore);
          this.debugEventAdapter.start();
          this.gatewayEventAdapter.start();
          await this.channelAdapterManager.applyConfig(this.channelAdapterConfigs);
          await this.channelAdapterManager.applyEnabledChannels(this.channelRouter.getEnabledChannels(), {
            reason: 'startup',
            source: 'gateway-startup',
          });
          this.eventBus.emit('channel.adapter.status.updated', {
            timestamp: Date.now(),
            reason: 'startup',
            source: 'gateway-startup',
            adapters: this.channelAdapterManager.getStatuses(),
          });
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

    this.debugEventAdapter.stop();
    this.gatewayEventAdapter.stop();
    this.schedulerEventAdapter.disconnect();
    this.ipcBridge.disconnect();
    await this.ipcServer.stop();
    await this.channelAdapterManager.stopAll({
      reason: 'shutdown',
      source: 'gateway-stop',
    });

    if (this.runtimeEventStoreBinding) {
      await this.runtimeEventStoreBinding.stop();
      this.runtimeEventStoreBinding = null;
    }

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
    return {
      isRunning: this.isRunning,
      address: this.isRunning ? `ws://${this.config.host}:${this.config.port}` : null,
      connections: this.connectionManager.getStats(),
      daemonConnected: this.daemonAttachment.isConnected(),
      schedulerConnected: this.schedulerBridge.isConnected(),
      debugMode: this.debugMode,
    };
  }

  getChannelAdapterStatuses(): GatewayChannelAdapterStatus[] {
    return this.channelAdapterManager.getStatuses();
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

  private collectSessionGoalCoverage(): {
    goalsTotal: number;
    goalsWithSessionLink: number;
    goalSessionCoverageRate: number;
  } {
    const goals = this.repository.listGoals({});
    const goalsTotal = goals.length;
    const goalsWithSessionLink = goals.filter((goal) => {
      const context = goal.context;
      if (!context || typeof context !== 'object') {
        return false;
      }

      const sessionId = (context as Record<string, unknown>).sessionId;
      return typeof sessionId === 'string' && sessionId.trim().length > 0;
    }).length;
    const goalSessionCoverageRate = goalsTotal > 0
      ? goalsWithSessionLink / goalsTotal
      : 0;

    this.runtimeRolloutTelemetry.recordGoalSessionCoverage({
      goalsTotal,
      goalsWithSessionLink,
    });

    return {
      goalsTotal,
      goalsWithSessionLink,
      goalSessionCoverageRate,
    };
  }

  private async evaluateRolloutThresholds(): Promise<void> {
    const runtime = loadRuntimeConfig();
    if (!runtime.scheduler.runtimeRollout.rollbackOnFailure) {
      return;
    }

    const isLegacyMode = runtime.scheduler.deterministicRuntimeEnabled === false
      && runtime.scheduler.planCompilerEnabled === false
      && runtime.scheduler.toolRoutingMode === 'legacy'
      && runtime.scheduler.runtimeRollout.shadowModeEnabled === false
      && runtime.scheduler.runtimeRollout.canaryPercent === 0
      && runtime.scheduler.runtimeRollout.lanePercents.dryRun === 0
      && runtime.scheduler.runtimeRollout.lanePercents.compile === 0
      && runtime.scheduler.runtimeRollout.lanePercents.replay === 0;
    if (isLegacyMode) {
      return;
    }

    this.collectSessionGoalCoverage();
    const metrics = this.runtimeRolloutTelemetry.snapshot();
    const sessionFirst = metrics.sessionFirst;
    const reasons: string[] = [];

    if (
      sessionFirst.conversationMessagesTotal >= GatewayServer.ROLLOUT_THRESHOLD_MIN_CONVERSATION_MESSAGES
      && sessionFirst.conversationMessageSuccessRate < GatewayServer.ROLLOUT_THRESHOLD_CONVERSATION_SUCCESS_RATE
    ) {
      reasons.push(
        `conversationMessageSuccessRate=${sessionFirst.conversationMessageSuccessRate.toFixed(3)} < ${GatewayServer.ROLLOUT_THRESHOLD_CONVERSATION_SUCCESS_RATE.toFixed(3)}`
      );
    }

    if (
      sessionFirst.runsTotal >= GatewayServer.ROLLOUT_THRESHOLD_MIN_RUNS
      && sessionFirst.runSuccessRate < GatewayServer.ROLLOUT_THRESHOLD_RUN_SUCCESS_RATE
    ) {
      reasons.push(
        `runSuccessRate=${sessionFirst.runSuccessRate.toFixed(3)} < ${GatewayServer.ROLLOUT_THRESHOLD_RUN_SUCCESS_RATE.toFixed(3)}`
      );
    }

    if (
      sessionFirst.goalsTotal >= GatewayServer.ROLLOUT_THRESHOLD_MIN_GOALS
      && sessionFirst.goalSessionCoverageRate < GatewayServer.ROLLOUT_THRESHOLD_GOAL_SESSION_COVERAGE
    ) {
      reasons.push(
        `goalSessionCoverageRate=${sessionFirst.goalSessionCoverageRate.toFixed(3)} < ${GatewayServer.ROLLOUT_THRESHOLD_GOAL_SESSION_COVERAGE.toFixed(3)}`
      );
    }

    if (reasons.length === 0) {
      return;
    }

    console.warn(`[GatewayServer] Rollout threshold trigger detected: ${reasons.join('; ')}. Rolling back to legacy mode.`);
    await this.rollbackRuntimeRolloutOnFailure();
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

  private shouldStoreChannelEvent(event: string): boolean {
    for (const prefix of GatewayServer.CHANNEL_EVENT_PREFIXES) {
      if (event.startsWith(prefix)) {
        return true;
      }
    }

    return false;
  }

  private resolveChannelType(
    payload: Record<string, unknown>,
    gatewaySessionId?: string,
    sessionId?: string,
    metadataChannelType?: unknown,
    goalContextChannelType?: StoredChannelEvent['channelType']
  ): StoredChannelEvent['channelType'] {
    const overrides = this.channelRouter.getSessionChannelOverrides();
    const overrideChannelByGatewaySession = gatewaySessionId ? overrides[gatewaySessionId] : undefined;
    const overrideChannelBySession = sessionId ? overrides[sessionId] : undefined;
    const rawChannelType = typeof payload.channelType === 'string'
      ? payload.channelType
      : typeof metadataChannelType === 'string'
        ? metadataChannelType
        : goalContextChannelType ?? overrideChannelByGatewaySession ?? overrideChannelBySession;

    if (
      rawChannelType === 'tui'
      || rawChannelType === 'webui'
      || rawChannelType === 'email'
      || rawChannelType === 'telegram'
      || rawChannelType === 'whatsapp'
      || rawChannelType === 'discord'
    ) {
      return rawChannelType;
    }

    return undefined;
  }

  private resolveAdapterDeliveryChannels(sourceChannelType?: GatewayChannelType): GatewayChannelType[] {
    const enabledChannels = this.channelRouter
      .getEnabledChannels()
      .filter((channel): channel is Exclude<GatewayChannelType, 'tui'> => channel !== 'tui');
    if (enabledChannels.length === 0) {
      return [];
    }

    if (this.channelRouter.getMirrorToAllEnabledChannels()) {
      return enabledChannels;
    }

    if (sourceChannelType && sourceChannelType !== 'tui' && enabledChannels.includes(sourceChannelType)) {
      return [sourceChannelType];
    }

    return [];
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
