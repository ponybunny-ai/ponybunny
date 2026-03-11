import type { Goal, WorkItem, Run, Escalation } from '../work-order/types/index.js';

export interface DaemonEventSubscription {
  release(): void;
}

/**
 * Daemon-owned event source contract for runtime lifecycle notifications.
 *
 * Gateway transport code can subscribe to this surface, but ownership of the
 * callback registry lives with daemon/runtime code rather than gateway.
 */
export interface IDaemonEventEmitter {
  onGoalCreated(callback: (goal: Goal) => void): DaemonEventSubscription;
  onGoalUpdated(callback: (goal: Goal) => void): DaemonEventSubscription;
  onGoalCompleted(callback: (goal: Goal) => void): DaemonEventSubscription;
  onGoalCancelled(callback: (goalId: string, reason?: string) => void): DaemonEventSubscription;

  onWorkItemCreated(callback: (workItem: WorkItem) => void): DaemonEventSubscription;
  onWorkItemUpdated(callback: (workItem: WorkItem) => void): DaemonEventSubscription;
  onWorkItemCompleted(callback: (workItem: WorkItem) => void): DaemonEventSubscription;
  onWorkItemFailed(callback: (workItem: WorkItem, error: string) => void): DaemonEventSubscription;

  onRunStarted(callback: (run: Run) => void): DaemonEventSubscription;
  onRunCompleted(callback: (run: Run) => void): DaemonEventSubscription;

  onEscalationCreated(callback: (escalation: Escalation) => void): DaemonEventSubscription;
  onEscalationResolved(callback: (escalation: Escalation) => void): DaemonEventSubscription;
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

  private registerCallback<TCallback extends (...args: never[]) => void>(
    callbacks: TCallback[],
    callback: TCallback
  ): DaemonEventSubscription {
    callbacks.push(callback);

    let released = false;

    return {
      release: () => {
        if (released) {
          return;
        }

        released = true;
        const callbackIndex = callbacks.indexOf(callback);

        if (callbackIndex >= 0) {
          callbacks.splice(callbackIndex, 1);
        }
      },
    };
  }

  private emitCallbacks<TArgs extends unknown[]>(
    callbacks: Array<(...args: TArgs) => void>,
    ...args: TArgs
  ): void {
    for (const callback of [...callbacks]) {
      callback(...args);
    }
  }

  onGoalCreated(callback: (goal: Goal) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.goalCreated, callback);
  }

  onGoalUpdated(callback: (goal: Goal) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.goalUpdated, callback);
  }

  onGoalCompleted(callback: (goal: Goal) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.goalCompleted, callback);
  }

  onGoalCancelled(callback: (goalId: string, reason?: string) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.goalCancelled, callback);
  }

  onWorkItemCreated(callback: (workItem: WorkItem) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.workItemCreated, callback);
  }

  onWorkItemUpdated(callback: (workItem: WorkItem) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.workItemUpdated, callback);
  }

  onWorkItemCompleted(callback: (workItem: WorkItem) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.workItemCompleted, callback);
  }

  onWorkItemFailed(callback: (workItem: WorkItem, error: string) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.workItemFailed, callback);
  }

  onRunStarted(callback: (run: Run) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.runStarted, callback);
  }

  onRunCompleted(callback: (run: Run) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.runCompleted, callback);
  }

  onEscalationCreated(callback: (escalation: Escalation) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.escalationCreated, callback);
  }

  onEscalationResolved(callback: (escalation: Escalation) => void): DaemonEventSubscription {
    return this.registerCallback(this.callbacks.escalationResolved, callback);
  }

  protected emitGoalCreated(goal: Goal): void {
    this.emitCallbacks(this.callbacks.goalCreated, goal);
  }

  protected emitGoalUpdated(goal: Goal): void {
    this.emitCallbacks(this.callbacks.goalUpdated, goal);
  }

  protected emitGoalCompleted(goal: Goal): void {
    this.emitCallbacks(this.callbacks.goalCompleted, goal);
  }

  protected emitGoalCancelled(goalId: string, reason?: string): void {
    this.emitCallbacks(this.callbacks.goalCancelled, goalId, reason);
  }

  protected emitWorkItemCreated(workItem: WorkItem): void {
    this.emitCallbacks(this.callbacks.workItemCreated, workItem);
  }

  protected emitWorkItemUpdated(workItem: WorkItem): void {
    this.emitCallbacks(this.callbacks.workItemUpdated, workItem);
  }

  protected emitWorkItemCompleted(workItem: WorkItem): void {
    this.emitCallbacks(this.callbacks.workItemCompleted, workItem);
  }

  protected emitWorkItemFailed(workItem: WorkItem, error: string): void {
    this.emitCallbacks(this.callbacks.workItemFailed, workItem, error);
  }

  protected emitRunStarted(run: Run): void {
    this.emitCallbacks(this.callbacks.runStarted, run);
  }

  protected emitRunCompleted(run: Run): void {
    this.emitCallbacks(this.callbacks.runCompleted, run);
  }

  protected emitEscalationCreated(escalation: Escalation): void {
    this.emitCallbacks(this.callbacks.escalationCreated, escalation);
  }

  protected emitEscalationResolved(escalation: Escalation): void {
    this.emitCallbacks(this.callbacks.escalationResolved, escalation);
  }
}
