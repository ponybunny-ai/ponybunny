/**
 * Scheduler Daemon - Autonomous execution engine
 *
 * Runs as a separate process from Gateway, executing goals through the 8-phase lifecycle.
 * Sends scheduler and debug events to Gateway via IPC for real-time monitoring.
 */

import type Database from 'better-sqlite3';
import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IExecutionService } from '../app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../infra/llm/llm-provider.js';
import type { RuntimeToolingContext } from '../runtime/tooling-context/index.js';
import type { SchedulerEvent } from '../scheduler/types.js';
import type { DebugEvent } from '../debug/types.js';
import { LocalExecutionAdapter } from '../runtime/execution-boundary/index.js';
import { LocalExecutionWorker } from '../runtime/workers/index.js';
import { SchedulerCore } from '../scheduler/core/index.js';
import { createScheduler } from '../gateway/integration/scheduler-factory.js';
import { IPCClient } from '../ipc/ipc-client.js';
import { IPCServer } from '../ipc/ipc-server.js';
import { debugEmitter } from '../debug/emitter.js';
import type { AnyIPCMessage, SchedulerCommandRequest } from '../ipc/types.js';
import { SchedulerSessionIntake } from './session-intake.js';
import { getGlobalAgentRegistry } from '../infra/agents/agent-registry.js';
import { getGlobalRunnerRegistry } from '../infra/agents/runner-registry.js';
import { reconcileCronJobsFromRegistry } from '../infra/scheduler/cron-job-reconciler.js';
import { acquireSchedulerDaemonLock, releaseSchedulerDaemonLock } from './pid-lock.js';
import { AgentScheduler } from './agent-scheduler.js';
import { createSchemaDrivenAgentRunner } from '../infra/agents/schema-driven-agent-runner.js';
import { getLLMService } from '../infra/llm/index.js';
import { SchedulerEventEnvelopeResolver } from './scheduler-event-envelope.js';
import { getRuntimeConfigPath, loadRuntimeConfig, saveRuntimeConfig } from '../infra/config/runtime-config.js';
import type { EventedStartupReconciliationSummary } from '../scheduler/evented-dispatch-checkpoint.js';
import { reconcileEventedStartupCandidates } from './evented-startup-reconciliation.js';

function getRuntimeToolingContext(
  executionService: IExecutionService
): RuntimeToolingContext | undefined {
  if (!('getRuntimeToolingContext' in executionService)) {
    return undefined;
  }

  const candidate = executionService as IExecutionService & {
    getRuntimeToolingContext: () => RuntimeToolingContext;
  };
  return candidate.getRuntimeToolingContext();
}

export interface SchedulerDaemonConfig {
  /** Path to Gateway IPC socket */
  ipcSocketPath: string;
  /** Path to local scheduler control socket */
  controlSocketPath?: string;
  /** Database path */
  dbPath: string;
  /** Enable debug mode */
  debug?: boolean;
  /** Scheduler tick interval in milliseconds */
  tickIntervalMs?: number;
  /** Maximum concurrent goals */
  maxConcurrentGoals?: number;
  executionMode?: 'direct' | 'evented';
  deterministicRuntimeEnabled?: boolean;
  planCompilerEnabled?: boolean;
  toolRoutingMode?: 'legacy' | 'system_only' | 'system_preferred' | 'model_preferred';
  runtimeRollout?: {
    shadowModeEnabled: boolean;
    canaryPercent: number;
    rollbackOnFailure: boolean;
    lanePercents: {
      dryRun: number;
      compile: number;
      replay: number;
    };
  };
  eventedOrphanTimeoutMs?: number;
  runEventRetention?: {
    enabled: boolean;
    intervalMs: number;
    maxAgeMs: number;
    keepLatestPerRun: number;
  };
  agentsEnabled?: boolean;
  mainAgentId?: string;
  personaEnabled?: boolean;
  memoryDb?: Database.Database;
}

function resolveMainAgentId(configuredId: string | undefined, availableIds: string[]): string | null {
  if (configuredId && availableIds.includes(configuredId)) {
    return configuredId;
  }

  if (availableIds.includes('lead')) {
    return 'lead';
  }

  return availableIds.length > 0 ? availableIds[0] : null;
}

export class SchedulerDaemon {
  private scheduler: SchedulerCore | null = null;
  private ipcClient: IPCClient;
  private controlServer: IPCServer | null = null;
  private repository: IWorkOrderRepository;
  private executionService: IExecutionService;
  private llmProvider: ILLMProvider;
  private config: SchedulerDaemonConfig;
  private isRunning = false;
  private hasPidLock = false;
  private agentScheduler: AgentScheduler | null = null;
  private agentSchedulerInterval: NodeJS.Timeout | null = null;
  private agentSchedulerDispatchActive = false;
  private retentionInterval: NodeJS.Timeout | null = null;
  private retentionDispatchActive = false;
  private sessionIntake: SchedulerSessionIntake | null = null;
  private memoryDb: Database.Database | null = null;
  private schedulerEventEnvelopeResolver: SchedulerEventEnvelopeResolver;
  private executionWorker: LocalExecutionWorker | null = null;
  private startupReconciliationSummary: EventedStartupReconciliationSummary | null = null;

  constructor(
    repository: IWorkOrderRepository,
    executionService: IExecutionService,
    llmProvider: ILLMProvider,
    config: SchedulerDaemonConfig
  ) {
    this.repository = repository;
    this.executionService = executionService;
    this.llmProvider = llmProvider;
    this.config = config;
    this.memoryDb = config.memoryDb ?? null;
    this.schedulerEventEnvelopeResolver = new SchedulerEventEnvelopeResolver(this.repository);

    // Initialize IPC client
    this.ipcClient = new IPCClient({
      socketPath: config.ipcSocketPath,
      autoReconnect: true,
      clientInfo: {
        clientType: 'scheduler-daemon',
        version: '1.0.0',
        pid: process.pid,
      },
    });

    this.ipcClient.onMessage((message) => {
      this.handleIPCMessage(message);
    });
  }

  /**
   * Start the scheduler daemon.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Scheduler Daemon is already running');
    }

    console.log('[SchedulerDaemon] Starting...');

    acquireSchedulerDaemonLock();
    this.hasPidLock = true;

    try {
      // Initialize database
      await this.repository.initialize();
      await this.reconcileEventedInFlightRunsOnStartup();

      const registry = getGlobalAgentRegistry();
      try {
        await registry.loadAgents({ workspaceDir: process.cwd() });
        const availableAgentIds = registry.getAgents().map((agent) => agent.id);
        const mainAgentId = resolveMainAgentId(this.config.mainAgentId, availableAgentIds);

        if (!mainAgentId) {
          console.warn('[SchedulerDaemon] No valid agents available; skipping cron job reconciliation');
        }

        const summary = await reconcileCronJobsFromRegistry({
          repository: this.repository,
          registry,
          ...(mainAgentId ? { mainAgentId } : {}),
        });

        if (mainAgentId) {
          console.log(`[SchedulerDaemon] Main agent selected: ${mainAgentId}`);
        }
        console.log(
          `[SchedulerDaemon] Cron job reconciliation complete: ` +
          `upserted=${summary.upserted}, disabled=${summary.disabled}, skipped=${summary.skipped}`
        );

        if (this.config.personaEnabled) {
          console.log('[SchedulerDaemon] Persona loading is enabled via runtime config');
        }
      } catch (error) {
        console.warn('[SchedulerDaemon] Cron job reconciliation failed:', error);
      }

      // Connect to Gateway IPC
      await this.ipcClient.connect();
      console.log('[SchedulerDaemon] Connected to Gateway IPC');

      await this.startControlServer();

      if (this.memoryDb) {
        this.sessionIntake = new SchedulerSessionIntake({
          repository: this.repository,
          memoryDb: this.memoryDb,
          llmService: getLLMService(),
          runtimeToolingContext: getRuntimeToolingContext(this.executionService),
          schedulerProvider: () => this.scheduler,
          publishSessionEvent: async (event) => {
            await this.ipcClient.send({
              type: 'session_event',
              timestamp: Date.now(),
              data: {
                event: event.event,
                gatewaySessionId: event.gatewaySessionId,
                sessionId: event.sessionId,
                payload: event.payload,
              },
            });
          },
        });
      } else {
        console.warn('[SchedulerDaemon] Session intake disabled: memoryDb not configured');
      }

      // Create scheduler with all dependencies
      const schedulerTickIntervalMs = this.config.tickIntervalMs ?? 1000;
      const executionPort = new LocalExecutionAdapter(this.executionService);
      this.executionWorker = new LocalExecutionWorker(executionPort);
      this.executionWorker.start();
      this.scheduler = createScheduler(
        {
          repository: this.repository,
          executionService: this.executionService,
          llmProvider: this.llmProvider,
          executionPort,
        },
        {
          tickIntervalMs: schedulerTickIntervalMs,
          maxConcurrentGoals: this.config.maxConcurrentGoals ?? 5,
          autoStart: false,
          debug: this.config.debug ?? false,
          executionMode: this.config.executionMode ?? 'direct',
          deterministicRuntimeEnabled: this.config.deterministicRuntimeEnabled ?? false,
          planCompilerEnabled: this.config.planCompilerEnabled ?? false,
          toolRoutingMode: this.config.toolRoutingMode ?? 'legacy',
          runtimeRollout: this.config.runtimeRollout ?? {
            shadowModeEnabled: false,
            canaryPercent: 0,
            rollbackOnFailure: true,
            lanePercents: {
              dryRun: 0,
              compile: 0,
              replay: 0,
            },
          },
        }
      );

      // Subscribe to scheduler events and forward to Gateway
      this.scheduler.on((event: SchedulerEvent) => {
        this.handleSchedulerEvent(event);
      });

      // Enable debug mode and forward debug events to Gateway
      if (this.config.debug) {
        debugEmitter.enable();
        debugEmitter.onDebug((event: DebugEvent) => {
          console.log(
            `[SchedulerDebug] ${event.type} source=${event.source} goal=${event.goalId ?? '-'} workItem=${event.workItemId ?? '-'} run=${event.runId ?? '-'} data=${JSON.stringify(event.data)}`
          );
          this.handleDebugEvent(event);
        });
        console.log('[SchedulerDaemon] Debug mode enabled');
      }

      // Start scheduler
      await this.scheduler.start();

      await this.recoverQueuedGoals();

      this.isRunning = true;

      const runnerRegistry = getGlobalRunnerRegistry();
      const schemaRunner = createSchemaDrivenAgentRunner();
      runnerRegistry.register('default', schemaRunner);
      runnerRegistry.register('market_listener', schemaRunner);
      console.log('[SchedulerDaemon] Registered default schema-driven runner');

      if (this.config.agentsEnabled) {
        this.agentScheduler = new AgentScheduler(
          {
            repository: this.repository,
            scheduler: this.scheduler,
            registry: registry,
            logger: console,
          },
          {
            claimTtlMs: schedulerTickIntervalMs * 2,
            instanceId: `scheduler-daemon-${process.pid}`,
          }
        );
        this.agentSchedulerInterval = setInterval(() => {
          if (this.agentSchedulerDispatchActive || !this.agentScheduler) {
            return;
          }

          this.agentSchedulerDispatchActive = true;
          this.agentScheduler
            .dispatchOnce()
            .catch((error) => {
              console.error('[SchedulerDaemon] AgentScheduler dispatch failed:', error);
            })
            .finally(() => {
              this.agentSchedulerDispatchActive = false;
            });
        }, schedulerTickIntervalMs);
        console.log('[SchedulerDaemon] AgentScheduler loop enabled');
      }

      this.startRunEventRetentionLoop();

      console.log('[SchedulerDaemon] Started successfully');
    } catch (error) {
      if (this.agentSchedulerInterval) {
        clearInterval(this.agentSchedulerInterval);
        this.agentSchedulerInterval = null;
      }
      if (this.retentionInterval) {
        clearInterval(this.retentionInterval);
        this.retentionInterval = null;
      }
      this.retentionDispatchActive = false;
      this.agentScheduler = null;
      this.executionWorker?.stop();
      this.executionWorker = null;
      if (this.controlServer) {
        await this.controlServer.stop();
        this.controlServer = null;
      }
      if (this.hasPidLock) {
        releaseSchedulerDaemonLock();
        this.hasPidLock = false;
      }
      throw error;
    }
  }

  /**
   * Stop the scheduler daemon.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[SchedulerDaemon] Stopping...');

    this.isRunning = false;

    if (this.agentSchedulerInterval) {
      clearInterval(this.agentSchedulerInterval);
      this.agentSchedulerInterval = null;
    }
    if (this.retentionInterval) {
      clearInterval(this.retentionInterval);
      this.retentionInterval = null;
    }
    this.retentionDispatchActive = false;
    this.agentScheduler = null;
    this.sessionIntake = null;
    this.executionWorker?.stop();
    this.executionWorker = null;

    if (this.memoryDb) {
      this.memoryDb.close();
      this.memoryDb = null;
    }

    // Stop scheduler
    if (this.scheduler) {
      await this.scheduler.stop();
      this.scheduler = null;
    }

    // Disable debug mode
    if (this.config.debug) {
      debugEmitter.disable();
    }

    // Disconnect from Gateway IPC
    await this.ipcClient.disconnect();

    if (this.controlServer) {
      await this.controlServer.stop();
      this.controlServer = null;
    }

    // Close database
    this.repository.close();

    if (this.hasPidLock) {
      releaseSchedulerDaemonLock();
      this.hasPidLock = false;
    }

    console.log('[SchedulerDaemon] Stopped');
  }

  /**
   * Get scheduler instance (for testing/inspection).
   */
  getScheduler(): SchedulerCore | null {
    return this.scheduler;
  }

  /**
   * Get IPC client (for testing/inspection).
   */
  getIPCClient(): IPCClient {
    return this.ipcClient;
  }

  getStartupReconciliationSummary(): EventedStartupReconciliationSummary | null {
    return this.startupReconciliationSummary;
  }

  /**
   * Check if daemon is running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Handle scheduler event and send to Gateway via IPC.
   */
  private handleSchedulerEvent(event: SchedulerEvent): void {
    const enrichedEvent = this.schedulerEventEnvelopeResolver.resolve(event);
    const message: AnyIPCMessage = {
      type: 'scheduler_event',
      timestamp: Date.now(),
      data: enrichedEvent,
    };

    this.ipcClient.send(message).catch((error) => {
      console.error('[SchedulerDaemon] Failed to send scheduler event:', error);
    });

    this.agentScheduler?.handleSchedulerEvent(event).catch((error) => {
      console.error('[SchedulerDaemon] Failed to handle scheduler event:', error);
    });
  }

  /**
   * Handle debug event and send to Gateway via IPC.
   */
  private handleDebugEvent(event: DebugEvent): void {
    const message: AnyIPCMessage = {
      type: 'debug_event',
      timestamp: Date.now(),
      data: event,
    };

    this.ipcClient.send(message).catch((error) => {
      console.error('[SchedulerDaemon] Failed to send debug event:', error);
    });
  }

  private handleIPCMessage(message: AnyIPCMessage): void {
    if (message.type !== 'scheduler_command' || !message.data) {
      return;
    }

    void this.handleSchedulerCommand(message.data as SchedulerCommandRequest);
  }

  private async startControlServer(): Promise<void> {
    const controlSocketPath =
      this.config.controlSocketPath ??
      `${this.config.ipcSocketPath}.scheduler-control`;
    this.controlServer = new IPCServer({
      socketPath: controlSocketPath,
    });
    this.controlServer.onMessage((message, clientId) => {
      if (message.type !== 'scheduler_command' || !message.data) {
        return;
      }

      void this.handleSchedulerCommand(
        message.data as SchedulerCommandRequest,
        async (requestId, success, error, result) => {
          const controlServer = this.controlServer;
          if (!controlServer) {
            return;
          }

          controlServer.sendToClient(clientId, {
            type: 'scheduler_command_result',
            timestamp: Date.now(),
            data: {
              requestId,
              success,
              error,
              result,
            },
          });
        }
      );
    });

    await this.controlServer.start();
    console.log(`[SchedulerDaemon] Control socket listening on ${controlSocketPath}`);
  }

  private async reconcileEventedInFlightRunsOnStartup(): Promise<void> {
    if ((this.config.executionMode ?? 'direct') !== 'evented') {
      this.startupReconciliationSummary = null;
      return;
    }

    const summary = reconcileEventedStartupCandidates(
      this.repository.listInFlightRunReconciliationCandidates(),
      Date.now(),
      this.config.eventedOrphanTimeoutMs
    );
    this.startupReconciliationSummary = summary;

    console.log(
      '[SchedulerDaemon] Evented startup reconciliation: ' +
      `scanned=${summary.scanned} ` +
      `stale_timeout_exceeded=${summary.staleTimeoutExceeded} ` +
      `likely_orphaned=${summary.byClassification.likely_orphaned} ` +
      `maybe_reattachable=${summary.byClassification.maybe_reattachable} ` +
      `already_terminal_in_db=${summary.byClassification.already_terminal_in_db} ` +
      `not_evented_candidate=${summary.byClassification.not_evented_candidate}`
    );

    for (const finding of summary.findings) {
      if (finding.staleTimeoutExceeded) {
        const markResult = this.repository.markEventedRunOrphaned(finding.runId, {
          classification: 'stale_timeout',
        });

        if (markResult.status === 'marked') {
          console.warn(
            '[SchedulerDaemon] Evented run marked orphaned: ' +
            `run=${finding.runId} workItem=${finding.workItemId} lane=${finding.laneId ?? '-'} ` +
            `ageMs=${finding.ageMs ?? '-'} dispatchedAt=${finding.dispatchedAt ?? '-'} ` +
            `reason=${finding.reason}`
          );
          debugEmitter.emitDebug('evented_run.orphan_marked', 'scheduler-daemon', {
            runId: finding.runId,
            goalId: finding.goalId,
            workItemId: finding.workItemId,
            laneId: finding.laneId,
            dispatchedAt: finding.dispatchedAt,
            ageMs: finding.ageMs,
            orphanClassification: 'stale_timeout',
            reason: finding.reason,
          });
        }
      }

      console.log(
        '[SchedulerDaemon] Evented startup finding: ' +
        `run=${finding.runId} workItem=${finding.workItemId} classification=${finding.classification} ` +
        `workItemStatus=${finding.workItemStatus} lane=${finding.laneId ?? '-'} ` +
        `dispatchedAt=${finding.dispatchedAt ?? '-'} staleTimeoutExceeded=${finding.staleTimeoutExceeded} ` +
        `reason=${finding.reason}`
      );
    }
  }

  private async handleSchedulerCommand(
    command: SchedulerCommandRequest,
    responder?: (
      requestId: string,
      success: boolean,
      error?: string,
      result?: unknown
    ) => Promise<void>
  ): Promise<void> {
    const scheduler = this.scheduler;
    const respond =
      responder ??
      (async (requestId: string, success: boolean, error?: string, result?: unknown) => {
        await this.sendSchedulerCommandResult(requestId, success, error, result);
      });

    if (!scheduler) {
      await respond(command.requestId, false, 'Scheduler is not initialized');
      return;
    }

    try {
      if (command.command === 'session_open') {
        if (!command.gatewaySessionId) {
          await respond(command.requestId, false, 'gatewaySessionId is required for session_open');
          return;
        }
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = await this.sessionIntake.openSession({
          gatewaySessionId: command.gatewaySessionId,
          personaId: command.personaId,
          userProfileId: command.userProfileId,
          channelType: command.channelType,
          channelSessionId: command.channelSessionId,
        });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'session_list') {
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = this.sessionIntake.listSessions({
          limit: command.limit,
          lifecycleState: command.lifecycleState,
        });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'session_message') {
        if (!command.gatewaySessionId) {
          await respond(command.requestId, false, 'gatewaySessionId is required for session_message');
          return;
        }
        if (!command.message || command.message.trim().length === 0) {
          await respond(command.requestId, false, 'message is required for session_message');
          return;
        }
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = await this.sessionIntake.processMessage({
          gatewaySessionId: command.gatewaySessionId,
          sessionId: command.sessionId,
          personaId: command.personaId,
          userProfileId: command.userProfileId,
          agentId: command.agentId,
          channelType: command.channelType,
          channelSessionId: command.channelSessionId,
          message: command.message,
          attachments: command.attachments,
        });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'session_history') {
        if (!command.sessionId) {
          await respond(command.requestId, false, 'sessionId is required for session_history');
          return;
        }
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = this.sessionIntake.getHistory({
          sessionId: command.sessionId,
          limit: command.limit,
        });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'session_end') {
        if (!command.sessionId) {
          await respond(command.requestId, false, 'sessionId is required for session_end');
          return;
        }
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = await this.sessionIntake.endSession({ sessionId: command.sessionId });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'session_archive') {
        if (!command.sessionId) {
          await respond(command.requestId, false, 'sessionId is required for session_archive');
          return;
        }
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = await this.sessionIntake.archiveSession({ sessionId: command.sessionId });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'session_resume') {
        if (!command.sessionId) {
          await respond(command.requestId, false, 'sessionId is required for session_resume');
          return;
        }
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = await this.sessionIntake.resumeSession({ sessionId: command.sessionId });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'session_status') {
        if (!command.sessionId) {
          await respond(command.requestId, false, 'sessionId is required for session_status');
          return;
        }
        if (!this.sessionIntake) {
          await respond(command.requestId, false, 'Session intake is not initialized');
          return;
        }

        const result = this.sessionIntake.getStatus({ sessionId: command.sessionId });
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'submit_goal') {
        if (!command.goalId) {
          await respond(command.requestId, false, 'goalId is required for submit_goal');
          return;
        }

        const goal = this.repository.getGoal(command.goalId);
        if (!goal) {
          await respond(command.requestId, false, `Goal not found: ${command.goalId}`);
          return;
        }

        await scheduler.submitGoal(goal);
        await respond(command.requestId, true);
        return;
      }

      if (command.command === 'replay_run') {
        if (!command.runId) {
          await respond(command.requestId, false, 'runId is required for replay_run');
          return;
        }

        const result = await scheduler.replayRun(command.runId);
        await respond(command.requestId, true, undefined, result);
        return;
      }

      if (command.command === 'materialize_goal') {
        if (!command.goalSpec) {
          await respond(command.requestId, false, 'goalSpec is required for materialize_goal');
          return;
        }

        const goal = this.repository.createGoal({
          title: command.goalSpec.title,
          description: command.goalSpec.description,
          success_criteria: command.goalSpec.success_criteria.map((item) => ({
            ...item,
            required: item.required ?? true,
          })),
          priority: command.goalSpec.priority,
          budget_tokens: command.goalSpec.budget_tokens,
          budget_time_minutes: command.goalSpec.budget_time_minutes,
          budget_cost_usd: command.goalSpec.budget_cost_usd,
          context: command.goalSpec.context,
        });

        let initialWorkItemId: string | undefined;
        if (command.initialWorkItemSpec) {
          const workItem = this.repository.createWorkItem({
            goal_id: goal.id,
            title: command.initialWorkItemSpec.title,
            description: command.initialWorkItemSpec.description,
            item_type: command.initialWorkItemSpec.item_type,
            priority: command.initialWorkItemSpec.priority,
            dependencies: command.initialWorkItemSpec.dependencies,
            context: command.initialWorkItemSpec.context,
          });
          initialWorkItemId = workItem.id;
        }

        if (command.autoSubmitGoal) {
          await scheduler.submitGoal(goal);
        }

        await respond(command.requestId, true, undefined, {
          goal,
          initialWorkItemId,
        });
        return;
      }

      if (command.command === 'cancel_goal') {
        if (!command.goalId) {
          await respond(command.requestId, false, 'goalId is required for cancel_goal');
          return;
        }

        await scheduler.cancelGoal(command.goalId);
        await respond(command.requestId, true);
        return;
      }

      if (command.command === 'apply_runtime_rollout') {
        if (!command.rollout) {
          await respond(command.requestId, false, 'rollout payload is required for apply_runtime_rollout');
          return;
        }

        this.config.deterministicRuntimeEnabled = command.rollout.deterministicRuntimeEnabled;
        this.config.planCompilerEnabled = command.rollout.planCompilerEnabled;
        this.config.toolRoutingMode = command.rollout.toolRoutingMode;
        this.config.runtimeRollout = command.rollout.runtimeRollout;
        scheduler.applyRuntimeRollout(command.rollout);
        await respond(command.requestId, true);
        return;
      }

      if (command.command === 'set_agent_model_override') {
        const agentId = typeof command.agentId === 'string' ? command.agentId.trim() : '';
        const modelRaw = typeof command.model === 'string' ? command.model.trim() : '';
        if (!agentId) {
          await respond(command.requestId, false, 'agentId is required for set_agent_model_override');
          return;
        }
        if (!modelRaw) {
          await respond(command.requestId, false, 'model is required for set_agent_model_override');
          return;
        }

        const runtime = loadRuntimeConfig();
        const nextOverrides = {
          ...(runtime.agent.modelOverrides ?? {}),
          [agentId]: modelRaw.toLowerCase() === 'auto' ? 'auto' : modelRaw,
        };
        runtime.agent.modelOverrides = nextOverrides;
        saveRuntimeConfig(runtime);

        await respond(command.requestId, true, undefined, {
          success: true,
          agentId,
          model: nextOverrides[agentId],
          configPath: getRuntimeConfigPath(),
        });
        return;
      }

      if (command.command === 'get_agent_model_override') {
        const agentId = typeof command.agentId === 'string' ? command.agentId.trim() : '';
        if (!agentId) {
          await respond(command.requestId, false, 'agentId is required for get_agent_model_override');
          return;
        }

        const runtime = loadRuntimeConfig();
        const stored = runtime.agent.modelOverrides?.[agentId];
        const model = typeof stored === 'string' && stored.trim().length > 0 && stored.trim().toLowerCase() !== 'auto'
          ? stored.trim()
          : null;
        await respond(command.requestId, true, undefined, {
          agentId,
          model,
        });
        return;
      }

      await respond(command.requestId, false, `Unknown scheduler command: ${command.command}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await respond(command.requestId, false, message);
    }
  }

  private async sendSchedulerCommandResult(
    requestId: string,
    success: boolean,
    error?: string,
    result?: unknown
  ): Promise<void> {
    const message: AnyIPCMessage = {
      type: 'scheduler_command_result',
      timestamp: Date.now(),
      data: {
        requestId,
        success,
        error,
        result,
      },
    };

    try {
      await this.ipcClient.send(message);
    } catch (sendError) {
      console.error('[SchedulerDaemon] Failed to send scheduler command result:', sendError);
    }
  }

  private async recoverQueuedGoals(): Promise<void> {
    const scheduler = this.scheduler;
    if (!scheduler) {
      return;
    }

    const queuedGoals = this.repository.listGoals({ status: 'queued' });
    if (queuedGoals.length === 0) {
      return;
    }

    let recovered = 0;
    for (const goal of queuedGoals) {
      try {
        await scheduler.submitGoal(goal);
        recovered += 1;
      } catch (error) {
        console.error(`[SchedulerDaemon] Failed to recover queued goal ${goal.id}:`, error);
      }
    }

    console.log(`[SchedulerDaemon] Recovered ${recovered}/${queuedGoals.length} queued goals`);
  }

  private startRunEventRetentionLoop(): void {
    const retention = this.config.runEventRetention;
    const pruneRunEvents = this.repository.pruneRunEvents?.bind(this.repository);
    if (!retention?.enabled || !pruneRunEvents) {
      return;
    }

    const runRetention = async (): Promise<void> => {
      if (this.retentionDispatchActive) {
        return;
      }

      this.retentionDispatchActive = true;
      const timestamp = Date.now();
      let ok = false;
      let deleted = 0;
      try {
        const beforeTsMs = timestamp - retention.maxAgeMs;
        const result = pruneRunEvents({
          before_ts_ms: beforeTsMs,
          keep_latest_per_run: retention.keepLatestPerRun,
        });
        deleted = result.deleted;
        ok = true;
      } catch (error) {
        console.error('[SchedulerDaemon] Run event retention failed:', error);
      } finally {
        this.retentionDispatchActive = false;
        await this.ipcClient.send({
          type: 'run_event_retention',
          timestamp,
          data: {
            deleted,
            ok,
            timestamp,
          },
        }).catch((error) => {
          console.error('[SchedulerDaemon] Failed to send retention telemetry:', error);
        });
      }
    };

    this.retentionInterval = setInterval(() => {
      void runRetention();
    }, retention.intervalMs);
    void runRetention();
  }
}
