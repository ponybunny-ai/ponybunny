/**
 * Scheduler Bridge - Connects SchedulerCore events to Gateway EventBus
 *
 * This bridge translates Scheduler events into Gateway events that get
 * broadcast to connected WebSocket clients.
 */

import type { EventBus } from '../events/event-bus.js';
import type { SchedulerEvent, SchedulerEventHandler } from '../../scheduler/types.js';
import type { ISchedulerCore } from '../../scheduler/core/index.js';

/**
 * SchedulerBridge connects scheduler events to the gateway event bus
 */
export class SchedulerBridge {
  private eventBus: EventBus;
  private scheduler: ISchedulerCore | null = null;
  private eventHandler: SchedulerEventHandler | null = null;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Connect to a scheduler instance
   */
  connect(scheduler: ISchedulerCore): void {
    if (this.scheduler) {
      console.warn('[SchedulerBridge] Already connected to a scheduler');
      return;
    }

    this.scheduler = scheduler;

    // Create event handler
    this.eventHandler = (event: SchedulerEvent) => {
      this.handleSchedulerEvent(event);
    };

    // Subscribe to scheduler events
    scheduler.on(this.eventHandler);

    console.log('[SchedulerBridge] Connected to scheduler');
  }

  /**
   * Disconnect from the scheduler
   */
  disconnect(): void {
    if (this.scheduler && this.eventHandler) {
      this.scheduler.off(this.eventHandler);
      this.scheduler = null;
      this.eventHandler = null;
      console.log('[SchedulerBridge] Disconnected from scheduler');
    }
  }

  /**
   * Check if bridge is connected
   */
  isConnected(): boolean {
    return this.scheduler !== null;
  }

  /**
   * Handle a scheduler event and emit to gateway event bus
   */
  private handleSchedulerEvent(event: SchedulerEvent): void {
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
        // Unknown event type, log for debugging
        console.warn('[SchedulerBridge] Unknown event type:', event.type);
    }
  }

  /**
   * Manually emit an event (for testing or direct integration)
   */
  emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }
}
