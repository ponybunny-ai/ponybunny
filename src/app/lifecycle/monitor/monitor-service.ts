import type { IWorkOrderRepository } from '../../../infra/persistence/repository-interface.js';
import type { IMonitorService, MonitorResult } from '../stage-interfaces.js';

export class MonitorService implements IMonitorService {
  constructor(private repository: IWorkOrderRepository) {}

  async checkHealth(): Promise<MonitorResult> {
    const allGoals = this.repository.listGoals();
    const activeGoals = allGoals.filter(g => g.status === 'active');
    
    const allWorkItems = activeGoals.flatMap(goal => 
      this.repository.getReadyWorkItems(goal.id)
    );
    
    const readyWorkItems = allWorkItems.filter(wi => wi.status === 'ready');
    const doneWorkItems = allWorkItems.filter(wi => wi.status === 'done');
    
    const completionRate = allWorkItems.length > 0
      ? doneWorkItems.length / allWorkItems.length
      : 0;

    let totalBudget = 0;
    let totalSpent = 0;

    for (const goal of activeGoals) {
      if (goal.budget_tokens) {
        totalBudget += goal.budget_tokens;
        totalSpent += goal.spent_tokens;
      }
    }

    const budgetUtilization = totalBudget > 0
      ? totalSpent / totalBudget
      : 0;

    const alerts: string[] = [];

    if (budgetUtilization > 0.9) {
      alerts.push(`Budget utilization is ${(budgetUtilization * 100).toFixed(1)}% - approaching limits`);
    }

    const blockedItems = allWorkItems.filter(wi => wi.status === 'blocked');
    if (blockedItems.length > 0) {
      alerts.push(`${blockedItems.length} work items are blocked - requires intervention`);
    }

    return {
      metrics: {
        activeGoals: activeGoals.length,
        readyWorkItems: readyWorkItems.length,
        completionRate,
        budgetUtilization,
      },
      alerts,
    };
  }
}
