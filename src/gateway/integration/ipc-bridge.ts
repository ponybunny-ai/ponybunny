/**
 * IPC Bridge - Routes IPC messages to Gateway EventBus
 *
 * Subscribes to IPC server messages and routes them to the appropriate
 * Gateway subsystems (EventBus for scheduler events, debugEmitter for debug events).
 */

import type { EventBus } from '../events/event-bus.js';
import type { IPCServer, IPCMessageHandler } from '../../ipc/ipc-server.js';
import type { AnyIPCMessage } from '../../ipc/types.js';
import { debugEmitter } from '../../debug/emitter.js';

export class IPCBridge {
  private eventBus: EventBus;
  private ipcServer: IPCServer | null = null;
  private messageHandler: IPCMessageHandler | null = null;

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
      console.log('[IPCBridge] Disconnected from IPC server');
    }
  }

  /**
   * Check if bridge is connected.
   */
  isConnected(): boolean {
    return this.ipcServer !== null;
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

      default:
        // Ignore ping/pong/connect/disconnect messages
        break;
    }
  }

  /**
   * Handle scheduler event from Daemon.
   * Routes to EventBus using the same pattern as SchedulerBridge.
   */
  private handleSchedulerEvent(message: AnyIPCMessage, clientId: string): void {
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
  private handleDebugEvent(message: AnyIPCMessage, clientId: string): void {
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
}
