import type { GoalStatus, WorkItemStatus, RunStatus } from '../types.js';

export const GOAL_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  queued: ['active', 'cancelled'],
  active: ['blocked', 'completed', 'cancelled'],
  blocked: ['active', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const WORK_ITEM_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  queued: ['ready', 'blocked'],
  ready: ['in_progress', 'blocked'],
  in_progress: ['verify', 'failed', 'blocked'],
  verify: ['done', 'failed'],
  done: [],
  failed: ['ready', 'blocked'],
  blocked: ['ready'],
};

export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  running: ['success', 'failure', 'timeout', 'aborted'],
  success: [],
  failure: [],
  timeout: [],
  aborted: [],
};

export function canTransitionGoal(from: GoalStatus, to: GoalStatus): boolean {
  return GOAL_TRANSITIONS[from].includes(to);
}

export function canTransitionWorkItem(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return WORK_ITEM_TRANSITIONS[from].includes(to);
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}
