/**
 * Daemon Bridge - Connects AutonomyDaemon events to Gateway
 *
 * This bridge allows the AutonomyDaemon to emit events that get
 * broadcast to connected Gateway clients.
 */

import type { EventBus } from '../events/event-bus.js';
import type { IDaemonEventEmitter } from '../../autonomy/daemon-event-emitter.js';
export {
  DaemonEventEmitterMixin,
  type IDaemonEventEmitter,
} from '../../autonomy/daemon-event-emitter.js';

/**
 * DaemonBridge connects daemon events to the gateway event bus
 */
export class DaemonBridge {
  private eventBus: EventBus;
  private connected = false;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Connect to a daemon's event emitter
   */
  connect(daemon: IDaemonEventEmitter): void {
    if (this.connected) {
      console.warn('[DaemonBridge] Already connected to a daemon');
      return;
    }

    // Goal events
    daemon.onGoalCreated((goal) => {
      this.eventBus.emit('goal.created', {
        goalId: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority,
      });
    });

    daemon.onGoalUpdated((goal) => {
      this.eventBus.emit('goal.updated', {
        goalId: goal.id,
        title: goal.title,
        status: goal.status,
        spent_tokens: goal.spent_tokens,
        spent_time_minutes: goal.spent_time_minutes,
        spent_cost_usd: goal.spent_cost_usd,
      });
    });

    daemon.onGoalCompleted((goal) => {
      this.eventBus.emit('goal.completed', {
        goalId: goal.id,
        title: goal.title,
        spent_tokens: goal.spent_tokens,
        spent_time_minutes: goal.spent_time_minutes,
        spent_cost_usd: goal.spent_cost_usd,
      });
    });

    daemon.onGoalCancelled((goalId, reason) => {
      this.eventBus.emit('goal.cancelled', {
        goalId,
        reason,
      });
    });

    // Work item events
    daemon.onWorkItemCreated((workItem) => {
      this.eventBus.emit('workitem.created', {
        workItemId: workItem.id,
        goalId: workItem.goal_id,
        title: workItem.title,
        status: workItem.status,
        item_type: workItem.item_type,
      });
    });

    daemon.onWorkItemUpdated((workItem) => {
      this.eventBus.emit('workitem.updated', {
        workItemId: workItem.id,
        goalId: workItem.goal_id,
        title: workItem.title,
        status: workItem.status,
        retry_count: workItem.retry_count,
      });
    });

    daemon.onWorkItemCompleted((workItem) => {
      this.eventBus.emit('workitem.completed', {
        workItemId: workItem.id,
        goalId: workItem.goal_id,
        title: workItem.title,
      });
    });

    daemon.onWorkItemFailed((workItem, error) => {
      this.eventBus.emit('workitem.failed', {
        workItemId: workItem.id,
        goalId: workItem.goal_id,
        title: workItem.title,
        error,
        retry_count: workItem.retry_count,
        max_retries: workItem.max_retries,
      });
    });

    // Run events
    daemon.onRunStarted((run) => {
      this.eventBus.emit('run.started', {
        runId: run.id,
        workItemId: run.work_item_id,
        goalId: run.goal_id,
        agent_type: run.agent_type,
        run_sequence: run.run_sequence,
      });
    });

    daemon.onRunCompleted((run) => {
      this.eventBus.emit('run.completed', {
        runId: run.id,
        workItemId: run.work_item_id,
        goalId: run.goal_id,
        status: run.status,
        tokens_used: run.tokens_used,
        time_seconds: run.time_seconds,
        cost_usd: run.cost_usd,
      });
    });

    // Escalation events
    daemon.onEscalationCreated((escalation) => {
      this.eventBus.emit('escalation.created', {
        escalationId: escalation.id,
        workItemId: escalation.work_item_id,
        goalId: escalation.goal_id,
        escalation_type: escalation.escalation_type,
        severity: escalation.severity,
        title: escalation.title,
        description: escalation.description,
      });
    });

    daemon.onEscalationResolved((escalation) => {
      this.eventBus.emit('escalation.resolved', {
        escalationId: escalation.id,
        workItemId: escalation.work_item_id,
        goalId: escalation.goal_id,
        resolution_action: escalation.resolution_action,
        resolver: escalation.resolver,
      });
    });

    this.connected = true;
    console.log('[DaemonBridge] Connected to daemon');
  }

  /**
   * Check if bridge is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Manually emit an event (for testing or direct integration)
   */
  emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }
}
