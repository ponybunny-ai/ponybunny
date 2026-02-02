import type { Goal, WorkItem } from '../../../work-order/types/index.js';
import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IPlanningService, PlanningResult } from '../stage-interfaces.js';
import { validateWorkItemInvariants, checkWorkItemReadiness } from '../../../domain/work-order/invariants.js';

export class PlanningService implements IPlanningService {
  constructor(private repository: IWorkOrderRepository) {}

  async planWorkItems(goal: Goal): Promise<PlanningResult> {
    const workItems: WorkItem[] = [];
    const dependencies = new Map<string, string[]>();

    const existingItems = this.repository.getReadyWorkItems(goal.id);
    
    if (existingItems.length > 0) {
      return {
        workItems: existingItems,
        dependencies: this.buildDependencyMap(existingItems),
      };
    }

    return {
      workItems,
      dependencies,
    };
  }

  private buildDependencyMap(workItems: WorkItem[]): Map<string, string[]> {
    const deps = new Map<string, string[]>();
    
    for (const item of workItems) {
      deps.set(item.id, item.dependencies);
    }
    
    return deps;
  }

  private validateDAG(workItems: WorkItem[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const itemMap = new Map<string, WorkItem>();
    
    for (const item of workItems) {
      itemMap.set(item.id, item);
    }

    for (const item of workItems) {
      const violations = validateWorkItemInvariants(item, itemMap);
      
      for (const violation of violations) {
        errors.push(`Work item ${item.id} (${item.title}): ${violation.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
