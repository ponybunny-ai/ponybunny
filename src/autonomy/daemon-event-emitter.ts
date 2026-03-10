import type { Goal, WorkItem, Run, Escalation } from '../work-order/types/index.js';

/**
 * Daemon-owned event source contract for runtime lifecycle notifications.
 *
 * Gateway transport code can subscribe to this surface, but ownership of the
 * callback registry lives with daemon/runtime code rather than gateway.
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
 * Simple callback registry for daemon/runtime-owned event emission.
 *
 * Historical gateway compatibility exports still point here, but the callback
 * ownership now lives under autonomy rather than a gateway transport module.
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
