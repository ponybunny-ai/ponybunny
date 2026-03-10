import type { IDaemonEventEmitter } from '../../autonomy/daemon-event-emitter.js';
import type { EventBus } from '../events/event-bus.js';

/**
 * Register gateway-owned forwarding from daemon runtime events onto the
 * gateway event bus. This preserves the transport/event translation boundary
 * without moving daemon-owned callback registry logic back under gateway.
 */
export function registerDaemonEventForwarders(
  eventBus: EventBus,
  daemon: IDaemonEventEmitter
): void {
  daemon.onGoalCreated((goal) => {
    eventBus.emit('goal.created', {
      goalId: goal.id,
      title: goal.title,
      status: goal.status,
      priority: goal.priority,
    });
  });

  daemon.onGoalUpdated((goal) => {
    eventBus.emit('goal.updated', {
      goalId: goal.id,
      title: goal.title,
      status: goal.status,
      spent_tokens: goal.spent_tokens,
      spent_time_minutes: goal.spent_time_minutes,
      spent_cost_usd: goal.spent_cost_usd,
    });
  });

  daemon.onGoalCompleted((goal) => {
    eventBus.emit('goal.completed', {
      goalId: goal.id,
      title: goal.title,
      spent_tokens: goal.spent_tokens,
      spent_time_minutes: goal.spent_time_minutes,
      spent_cost_usd: goal.spent_cost_usd,
    });
  });

  daemon.onGoalCancelled((goalId, reason) => {
    eventBus.emit('goal.cancelled', {
      goalId,
      reason,
    });
  });

  daemon.onWorkItemCreated((workItem) => {
    eventBus.emit('workitem.created', {
      workItemId: workItem.id,
      goalId: workItem.goal_id,
      title: workItem.title,
      status: workItem.status,
      item_type: workItem.item_type,
    });
  });

  daemon.onWorkItemUpdated((workItem) => {
    eventBus.emit('workitem.updated', {
      workItemId: workItem.id,
      goalId: workItem.goal_id,
      title: workItem.title,
      status: workItem.status,
      retry_count: workItem.retry_count,
    });
  });

  daemon.onWorkItemCompleted((workItem) => {
    eventBus.emit('workitem.completed', {
      workItemId: workItem.id,
      goalId: workItem.goal_id,
      title: workItem.title,
    });
  });

  daemon.onWorkItemFailed((workItem, error) => {
    eventBus.emit('workitem.failed', {
      workItemId: workItem.id,
      goalId: workItem.goal_id,
      title: workItem.title,
      error,
      retry_count: workItem.retry_count,
      max_retries: workItem.max_retries,
    });
  });

  daemon.onRunStarted((run) => {
    eventBus.emit('run.started', {
      runId: run.id,
      workItemId: run.work_item_id,
      goalId: run.goal_id,
      agent_type: run.agent_type,
      run_sequence: run.run_sequence,
    });
  });

  daemon.onRunCompleted((run) => {
    eventBus.emit('run.completed', {
      runId: run.id,
      workItemId: run.work_item_id,
      goalId: run.goal_id,
      status: run.status,
      tokens_used: run.tokens_used,
      time_seconds: run.time_seconds,
      cost_usd: run.cost_usd,
    });
  });

  daemon.onEscalationCreated((escalation) => {
    eventBus.emit('escalation.created', {
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
    eventBus.emit('escalation.resolved', {
      escalationId: escalation.id,
      workItemId: escalation.work_item_id,
      goalId: escalation.goal_id,
      resolution_action: escalation.resolution_action,
      resolver: escalation.resolver,
    });
  });
}
