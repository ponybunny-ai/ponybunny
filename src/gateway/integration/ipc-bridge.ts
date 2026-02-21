/**
 * IPC Bridge - Routes IPC messages to Gateway EventBus
 *
 * Subscribes to IPC server messages and routes them to the appropriate
 * Gateway subsystems (EventBus for scheduler events, debugEmitter for debug events).
 */

import type { EventBus } from '../events/event-bus.js';
import type { IPCServer, IPCMessageHandler } from '../../ipc/ipc-server.js';
import type {
  AnyIPCMessage,
  SchedulerCommandRequest,
  SchedulerCommandType,
} from '../../ipc/types.js';
import { debugEmitter } from '../../debug/emitter.js';

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class IPCBridge {
  private eventBus: EventBus;
  private ipcServer: IPCServer | null = null;
  private messageHandler: IPCMessageHandler | null = null;
  private pendingCommands = new Map<string, PendingCommand>();

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Connect to an IPC server and start routing messages.
   */
  connect(ipcServer: IPCServer): void {
    if (this.ipcServer) {
      console.warn('[IPCBridge] Already connected to an IPC server');
      return;
    }

    this.ipcServer = ipcServer;

    // Create message handler
    this.messageHandler = (message: AnyIPCMessage, clientId: string) => {
      this.handleIPCMessage(message, clientId);
    };

    // Subscribe to IPC messages
    ipcServer.onMessage(this.messageHandler);

    console.log('[IPCBridge] Connected to IPC server');
  }

  /**
   * Disconnect from the IPC server.
   */
  disconnect(): void {
    if (this.ipcServer && this.messageHandler) {
      this.ipcServer.offMessage(this.messageHandler);
      this.ipcServer = null;
      this.messageHandler = null;
      this.clearPendingCommands('IPC bridge disconnected');
      console.log('[IPCBridge] Disconnected from IPC server');
    }
  }

  /**
   * Check if bridge is connected.
   */
  isConnected(): boolean {
    return this.ipcServer !== null;
  }

  isSchedulerDaemonConnected(): boolean {
    return this.findSchedulerDaemonClientId() !== null;
  }

  async submitGoal(goalId: string): Promise<void> {
    await this.sendSchedulerCommand('submit_goal', { goalId });
  }

  async cancelGoal(goalId: string, reason?: string): Promise<void> {
    await this.sendSchedulerCommand('cancel_goal', { goalId, reason });
  }

  /**
   * Handle incoming IPC message and route to appropriate subsystem.
   */
  private handleIPCMessage(message: AnyIPCMessage, clientId: string): void {
    switch (message.type) {
      case 'scheduler_event':
        this.handleSchedulerEvent(message, clientId);
        break;

      case 'debug_event':
        this.handleDebugEvent(message, clientId);
        break;

      case 'scheduler_command_result':
        this.handleSchedulerCommandResult(message);
        break;

      default:
        // Ignore ping/pong/connect/disconnect messages
        break;
    }
  }

  /**
   * Handle scheduler event from Daemon.
   * Routes to EventBus using the same pattern as SchedulerBridge.
   */
  private handleSchedulerEvent(message: AnyIPCMessage, _clientId: string): void {
    if (message.type !== 'scheduler_event' || !message.data) {
      return;
    }

    const event = message.data as any;

    // Route to EventBus based on event type
    // This mirrors the logic in SchedulerBridge
    switch (event.type) {
      case 'goal_started':
        this.eventBus.emit('goal.started', {
          goalId: event.goalId,
          timestamp: event.timestamp,
        });
        break;

      case 'goal_completed':
        this.eventBus.emit('goal.completed', {
          goalId: event.goalId,
          timestamp: event.timestamp,
        });
        break;

      case 'goal_failed':
        this.eventBus.emit('goal.failed', {
          goalId: event.goalId,
          error: event.data?.error,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_started':
        this.eventBus.emit('workitem.started', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          model: event.data?.model,
          laneId: event.data?.laneId,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_completed':
        this.eventBus.emit('workitem.completed', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          timestamp: event.timestamp,
        });
        break;

      case 'work_item_failed':
        this.eventBus.emit('workitem.failed', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          error: event.data?.error,
          timestamp: event.timestamp,
        });
        break;

      case 'run_started':
        this.eventBus.emit('run.started', {
          runId: event.runId,
          workItemId: event.workItemId,
          goalId: event.goalId,
          timestamp: event.timestamp,
        });
        break;

      case 'run_completed':
        this.eventBus.emit('run.completed', {
          runId: event.runId,
          workItemId: event.workItemId,
          goalId: event.goalId,
          success: event.data?.success,
          timestamp: event.timestamp,
        });
        break;

      case 'verification_started':
        this.eventBus.emit('verification.started', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          timestamp: event.timestamp,
        });
        break;

      case 'verification_completed':
        this.eventBus.emit('verification.completed', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          runId: event.runId,
          passed: event.data?.passed,
          summary: event.data?.summary,
          timestamp: event.timestamp,
        });
        break;

      case 'escalation_created':
        this.eventBus.emit('escalation.created', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          type: event.data?.type,
          error: event.data?.error,
          timestamp: event.timestamp,
        });
        break;

      case 'escalation_resolved':
        this.eventBus.emit('escalation.resolved', {
          workItemId: event.workItemId,
          goalId: event.goalId,
          timestamp: event.timestamp,
        });
        break;

      case 'budget_warning':
        this.eventBus.emit('budget.warning', {
          goalId: event.goalId,
          level: event.data?.level,
          status: event.data?.status,
          timestamp: event.timestamp,
        });
        break;

      case 'budget_exceeded':
        this.eventBus.emit('budget.exceeded', {
          goalId: event.goalId,
          timestamp: event.timestamp,
        });
        break;

      default:
        console.warn(`[IPCBridge] Unknown scheduler event type: ${event.type}`);
    }
  }

  /**
   * Handle debug event from Daemon.
   * Routes to debugEmitter for broadcasting to debug clients.
   */
  private handleDebugEvent(message: AnyIPCMessage, _clientId: string): void {
    if (message.type !== 'debug_event' || !message.data) {
      return;
    }

    const event = message.data as any;

    // Re-emit debug event through debugEmitter
    // This allows DebugBroadcaster to pick it up and send to clients
    if (debugEmitter.isEnabled()) {
      debugEmitter.emitDebug(event.type, event.source, event.data);
    }
  }

  private async sendSchedulerCommand(
    command: SchedulerCommandType,
    params: Omit<SchedulerCommandRequest, 'requestId' | 'command'>
  ): Promise<void> {
    const ipcServer = this.ipcServer;
    if (!ipcServer) {
      throw new Error('IPC server is not connected');
    }

    const schedulerClientId = this.findSchedulerDaemonClientId();
    if (!schedulerClientId) {
      throw new Error('Scheduler daemon is not connected');
    }

    const requestId = `ipc-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Scheduler command timed out: ${command}`));
      }, 5000);

      this.pendingCommands.set(requestId, { resolve, reject, timeout });

      try {
        ipcServer.sendToClient(schedulerClientId, {
          type: 'scheduler_command',
          timestamp: Date.now(),
          data: {
            requestId,
            command,
            ...params,
          },
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingCommands.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleSchedulerCommandResult(message: AnyIPCMessage): void {
    if (message.type !== 'scheduler_command_result' || !message.data) {
      return;
    }

    const requestId = typeof message.data.requestId === 'string' ? message.data.requestId : null;
    if (!requestId) {
      return;
    }

    const pending = this.pendingCommands.get(requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(requestId);

    if (message.data.success) {
      pending.resolve();
      return;
    }

    const errorMessage =
      typeof message.data.error === 'string' && message.data.error.length > 0
        ? message.data.error
        : 'Scheduler command failed';
    pending.reject(new Error(errorMessage));
  }

  private findSchedulerDaemonClientId(): string | null {
    if (!this.ipcServer) {
      return null;
    }

    const clients = this.ipcServer.getClients();
    const schedulerClient = clients.find((client) => client.clientInfo?.clientType === 'scheduler-daemon');
    return schedulerClient?.id ?? null;
  }

  private clearPendingCommands(reason: string): void {
    for (const [requestId, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      this.pendingCommands.delete(requestId);
    }
  }
}
