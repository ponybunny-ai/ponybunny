/**
 * Scheduler Daemon - Autonomous execution engine
 *
 * Runs as a separate process from Gateway, executing goals through the 8-phase lifecycle.
 * Sends scheduler and debug events to Gateway via IPC for real-time monitoring.
 */

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IExecutionService } from '../app/lifecycle/stage-interfaces.js';
import type { ILLMProvider } from '../infra/llm/llm-provider.js';
import type { AgentAService } from '../app/agents/agent-a/agent-a-service.js';
import type { SchedulerEvent } from '../scheduler/types.js';
import type { DebugEvent } from '../debug/types.js';
import { SchedulerCore } from '../scheduler/core/index.js';
import { createScheduler } from '../gateway/integration/scheduler-factory.js';
import { IPCClient } from '../ipc/ipc-client.js';
import { debugEmitter } from '../debug/emitter.js';
import type { AnyIPCMessage, SchedulerCommandRequest } from '../ipc/types.js';
import { getGlobalAgentRegistry } from '../infra/agents/agent-registry.js';
import { getGlobalRunnerRegistry } from '../infra/agents/runner-registry.js';
import { reconcileCronJobsFromRegistry } from '../infra/scheduler/cron-job-reconciler.js';
import { acquireSchedulerDaemonLock, releaseSchedulerDaemonLock } from './pid-lock.js';
import { AgentScheduler } from './agent-scheduler.js';
import { MarketListenerRunner } from '../infra/agents/market-listener-runner.js';

export interface SchedulerDaemonConfig {
  /** Path to Gateway IPC socket */
  ipcSocketPath: string;
  /** Database path */
  dbPath: string;
  /** Enable debug mode */
  debug?: boolean;
  /** Scheduler tick interval in milliseconds */
  tickIntervalMs?: number;
  /** Maximum concurrent goals */
  maxConcurrentGoals?: number;
  agentsEnabled?: boolean;
  agentAService?: AgentAService;
}

export class SchedulerDaemon {
  private scheduler: SchedulerCore | null = null;
  private ipcClient: IPCClient;
  private repository: IWorkOrderRepository;
  private executionService: IExecutionService;
  private llmProvider: ILLMProvider;
  private config: SchedulerDaemonConfig;
  private isRunning = false;
  private hasPidLock = false;
  private agentScheduler: AgentScheduler | null = null;
  private agentSchedulerInterval: NodeJS.Timeout | null = null;
  private agentSchedulerDispatchActive = false;

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

      const registry = getGlobalAgentRegistry();
      try {
        await registry.loadAgents({ workspaceDir: process.cwd() });
        const summary = await reconcileCronJobsFromRegistry({
          repository: this.repository,
          registry,
        });
        console.log(
          `[SchedulerDaemon] Cron job reconciliation complete: ` +
          `upserted=${summary.upserted}, disabled=${summary.disabled}, skipped=${summary.skipped}`
        );
      } catch (error) {
        console.warn('[SchedulerDaemon] Cron job reconciliation failed:', error);
      }

      // Connect to Gateway IPC
      await this.ipcClient.connect();
      console.log('[SchedulerDaemon] Connected to Gateway IPC');

      // Create scheduler with all dependencies
      const schedulerTickIntervalMs = this.config.tickIntervalMs ?? 1000;
      this.scheduler = createScheduler(
        {
          repository: this.repository,
          executionService: this.executionService,
          llmProvider: this.llmProvider,
        },
        {
          tickIntervalMs: schedulerTickIntervalMs,
          maxConcurrentGoals: this.config.maxConcurrentGoals ?? 5,
          autoStart: false,
          debug: this.config.debug ?? false,
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

      if (this.config.agentAService) {
        const runnerRegistry = getGlobalRunnerRegistry();
        runnerRegistry.register('market_listener', new MarketListenerRunner(this.config.agentAService));
        console.log('[SchedulerDaemon] Registered market_listener runner');
      }

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

      console.log('[SchedulerDaemon] Started successfully');
    } catch (error) {
      if (this.agentSchedulerInterval) {
        clearInterval(this.agentSchedulerInterval);
        this.agentSchedulerInterval = null;
      }
      this.agentScheduler = null;
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
    this.agentScheduler = null;

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
    const message: AnyIPCMessage = {
      type: 'scheduler_event',
      timestamp: Date.now(),
      data: event,
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

  private async handleSchedulerCommand(command: SchedulerCommandRequest): Promise<void> {
    const scheduler = this.scheduler;

    if (!scheduler) {
      await this.sendSchedulerCommandResult(command.requestId, false, 'Scheduler is not initialized');
      return;
    }

    try {
      if (command.command === 'submit_goal') {
        const goal = this.repository.getGoal(command.goalId);
        if (!goal) {
          await this.sendSchedulerCommandResult(command.requestId, false, `Goal not found: ${command.goalId}`);
          return;
        }

        await scheduler.submitGoal(goal);
        await this.sendSchedulerCommandResult(command.requestId, true);
        return;
      }

      if (command.command === 'cancel_goal') {
        await scheduler.cancelGoal(command.goalId);
        await this.sendSchedulerCommandResult(command.requestId, true);
        return;
      }

      await this.sendSchedulerCommandResult(command.requestId, false, `Unknown scheduler command: ${command.command}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sendSchedulerCommandResult(command.requestId, false, message);
    }
  }

  private async sendSchedulerCommandResult(
    requestId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const message: AnyIPCMessage = {
      type: 'scheduler_command_result',
      timestamp: Date.now(),
      data: {
        requestId,
        success,
        error,
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
}
