/**
 * Daemon Bridge - Connects AutonomyDaemon events to Gateway
 *
 * This bridge allows the AutonomyDaemon to emit events that get
 * broadcast to connected Gateway clients.
 */

import type { EventBus } from '../events/event-bus.js';
import type { Goal, WorkItem, Run, Escalation } from '../../work-order/types/index.js';

/**
 * Interface for daemon event emission
 * Implement this in AutonomyDaemon to emit events
 */
export interface IDaemonEventEmitter {
  onGoalCreated(callback: (goal: Goal) => void): void;
  onGoalUpdated(callback: (goal: Goal) => void): void;
  onGoalCompleted(callback: (goal: Goal) => void): void;
  onGoalCancelled(callback: (goalId: string, reason?: string) => void): void;

  onWorkItemCreated(callback: (workItem: WorkItem) => void): void;
  onWorkItemUpdated(callback: (workItem: WorkItem) => void): void;
  onWorkItemCompleted(callback: (workItem: WorkItem) => void): void;
  onWorkItemFailed(callback: (workItem: WorkItem, error: string) => void): void;

  onRunStarted(callback: (run: Run) => void): void;
  onRunCompleted(callback: (run: Run) => void): void;

  onEscalationCreated(callback: (escalation: Escalation) => void): void;
  onEscalationResolved(callback: (escalation: Escalation) => void): void;
}

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

/**
 * Simple event emitter mixin for AutonomyDaemon
 * Add this to the daemon class to enable event emission
 */
export class DaemonEventEmitterMixin implements IDaemonEventEmitter {
  private callbacks = {
    goalCreated: [] as Array<(goal: Goal) => void>,
    goalUpdated: [] as Array<(goal: Goal) => void>,
    goalCompleted: [] as Array<(goal: Goal) => void>,
    goalCancelled: [] as Array<(goalId: string, reason?: string) => void>,
    workItemCreated: [] as Array<(workItem: WorkItem) => void>,
    workItemUpdated: [] as Array<(workItem: WorkItem) => void>,
    workItemCompleted: [] as Array<(workItem: WorkItem) => void>,
    workItemFailed: [] as Array<(workItem: WorkItem, error: string) => void>,
    runStarted: [] as Array<(run: Run) => void>,
    runCompleted: [] as Array<(run: Run) => void>,
    escalationCreated: [] as Array<(escalation: Escalation) => void>,
    escalationResolved: [] as Array<(escalation: Escalation) => void>,
  };

  onGoalCreated(callback: (goal: Goal) => void): void {
    this.callbacks.goalCreated.push(callback);
  }

  onGoalUpdated(callback: (goal: Goal) => void): void {
    this.callbacks.goalUpdated.push(callback);
  }

  onGoalCompleted(callback: (goal: Goal) => void): void {
    this.callbacks.goalCompleted.push(callback);
  }

  onGoalCancelled(callback: (goalId: string, reason?: string) => void): void {
    this.callbacks.goalCancelled.push(callback);
  }

  onWorkItemCreated(callback: (workItem: WorkItem) => void): void {
    this.callbacks.workItemCreated.push(callback);
  }

  onWorkItemUpdated(callback: (workItem: WorkItem) => void): void {
    this.callbacks.workItemUpdated.push(callback);
  }

  onWorkItemCompleted(callback: (workItem: WorkItem) => void): void {
    this.callbacks.workItemCompleted.push(callback);
  }

  onWorkItemFailed(callback: (workItem: WorkItem, error: string) => void): void {
    this.callbacks.workItemFailed.push(callback);
  }

  onRunStarted(callback: (run: Run) => void): void {
    this.callbacks.runStarted.push(callback);
  }

  onRunCompleted(callback: (run: Run) => void): void {
    this.callbacks.runCompleted.push(callback);
  }

  onEscalationCreated(callback: (escalation: Escalation) => void): void {
    this.callbacks.escalationCreated.push(callback);
  }

  onEscalationResolved(callback: (escalation: Escalation) => void): void {
    this.callbacks.escalationResolved.push(callback);
  }

  // Emit methods for internal use
  protected emitGoalCreated(goal: Goal): void {
    this.callbacks.goalCreated.forEach(cb => cb(goal));
  }

  protected emitGoalUpdated(goal: Goal): void {
    this.callbacks.goalUpdated.forEach(cb => cb(goal));
  }

  protected emitGoalCompleted(goal: Goal): void {
    this.callbacks.goalCompleted.forEach(cb => cb(goal));
  }

  protected emitGoalCancelled(goalId: string, reason?: string): void {
    this.callbacks.goalCancelled.forEach(cb => cb(goalId, reason));
  }

  protected emitWorkItemCreated(workItem: WorkItem): void {
    this.callbacks.workItemCreated.forEach(cb => cb(workItem));
  }

  protected emitWorkItemUpdated(workItem: WorkItem): void {
    this.callbacks.workItemUpdated.forEach(cb => cb(workItem));
  }

  protected emitWorkItemCompleted(workItem: WorkItem): void {
    this.callbacks.workItemCompleted.forEach(cb => cb(workItem));
  }

  protected emitWorkItemFailed(workItem: WorkItem, error: string): void {
    this.callbacks.workItemFailed.forEach(cb => cb(workItem, error));
  }

  protected emitRunStarted(run: Run): void {
    this.callbacks.runStarted.forEach(cb => cb(run));
  }

  protected emitRunCompleted(run: Run): void {
    this.callbacks.runCompleted.forEach(cb => cb(run));
  }

  protected emitEscalationCreated(escalation: Escalation): void {
    this.callbacks.escalationCreated.forEach(cb => cb(escalation));
  }

  protected emitEscalationResolved(escalation: Escalation): void {
    this.callbacks.escalationResolved.forEach(cb => cb(escalation));
  }
}
