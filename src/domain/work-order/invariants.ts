import type { Goal, WorkItem } from '../types.js';

export interface InvariantViolation {
  field: string;
  message: string;
}

export function validateGoalInvariants(goal: Partial<Goal>): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (!goal.title || goal.title.trim().length === 0) {
    violations.push({ field: 'title', message: 'Title cannot be empty' });
  }

  if (!goal.success_criteria || goal.success_criteria.length === 0) {
    violations.push({ field: 'success_criteria', message: 'Must have at least 1 success criterion' });
  }

  if (goal.budget_tokens !== undefined && goal.budget_tokens <= 0) {
    violations.push({ field: 'budget_tokens', message: 'Budget tokens must be positive' });
  }

  if (goal.budget_time_minutes !== undefined && goal.budget_time_minutes <= 0) {
    violations.push({ field: 'budget_time_minutes', message: 'Budget time must be positive' });
  }

  if (goal.budget_cost_usd !== undefined && goal.budget_cost_usd <= 0) {
    violations.push({ field: 'budget_cost_usd', message: 'Budget cost must be positive' });
  }

  if (goal.spent_tokens !== undefined && goal.spent_tokens < 0) {
    violations.push({ field: 'spent_tokens', message: 'Spent tokens cannot be negative' });
  }

  if (goal.budget_tokens !== undefined && goal.spent_tokens !== undefined) {
    if (goal.spent_tokens > goal.budget_tokens) {
      violations.push({ 
        field: 'spent_tokens', 
        message: `Spent tokens (${goal.spent_tokens}) exceeds budget (${goal.budget_tokens})` 
      });
    }
  }

  return violations;
}

export function validateWorkItemInvariants(
  workItem: Partial<WorkItem>,
  allWorkItems: Map<string, WorkItem>
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  if (!workItem.goal_id) {
    violations.push({ field: 'goal_id', message: 'Must reference a goal' });
  }

  if (!workItem.title || workItem.title.trim().length === 0) {
    violations.push({ field: 'title', message: 'Title cannot be empty' });
  }

  if (workItem.dependencies && workItem.dependencies.length > 0) {
    for (const depId of workItem.dependencies) {
      if (!allWorkItems.has(depId)) {
        violations.push({ 
          field: 'dependencies', 
          message: `Dependency ${depId} does not exist` 
        });
      }
    }

    if (workItem.id && hasCyclicDependency(workItem.id, workItem.dependencies, allWorkItems)) {
      violations.push({ 
        field: 'dependencies', 
        message: 'Cyclic dependency detected' 
      });
    }
  }

  return violations;
}

function hasCyclicDependency(
  itemId: string,
  dependencies: string[],
  allWorkItems: Map<string, WorkItem>,
  visited: Set<string> = new Set()
): boolean {
  if (visited.has(itemId)) {
    return true;
  }

  visited.add(itemId);

  for (const depId of dependencies) {
    const dep = allWorkItems.get(depId);
    if (dep && hasCyclicDependency(depId, dep.dependencies, allWorkItems, new Set(visited))) {
      return true;
    }
  }

  return false;
}

export function checkWorkItemReadiness(
  workItem: WorkItem,
  allWorkItems: Map<string, WorkItem>
): boolean {
  return workItem.dependencies.every(depId => {
    const dep = allWorkItems.get(depId);
    return dep?.status === 'done';
  });
}
