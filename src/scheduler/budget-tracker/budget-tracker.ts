/**
 * Budget Tracker Implementation
 *
 * Monitors and tracks resource usage (tokens, time, cost) against goal budgets.
 */

import type { Goal } from '../../work-order/types/index.js';
import type { BudgetInfo, BudgetCheckResult, BudgetViolation } from '../types.js';
import type {
  IBudgetTracker,
  BudgetTrackerConfig,
  BudgetWarningLevel,
  BudgetStatus,
  BudgetWarningThresholds,
} from './types.js';

const DEFAULT_THRESHOLDS: BudgetWarningThresholds = {
  warningThreshold: 0.7,   // 70%
  criticalThreshold: 0.9,  // 90%
};

const DEFAULT_CONFIG: BudgetTrackerConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  allowOverage: false,
  maxOveragePercent: 0.1,  // 10%
};

export class BudgetTracker implements IBudgetTracker {
  private config: BudgetTrackerConfig;
  private usageCallbacks: Map<string, (tokens: number, timeSeconds: number, costUsd: number) => Promise<void>>;

  constructor(config?: Partial<BudgetTrackerConfig>) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        ...config?.thresholds,
      },
    };
    this.usageCallbacks = new Map();
  }

  /**
   * Check if goal is within budget
   */
  checkBudget(goal: Goal): BudgetCheckResult {
    const violations: BudgetViolation[] = [];

    // Check token budget
    if (goal.budget_tokens !== undefined && goal.budget_tokens !== null) {
      if (goal.spent_tokens > goal.budget_tokens) {
        violations.push({
          type: 'tokens',
          limit: goal.budget_tokens,
          current: goal.spent_tokens,
          overage: goal.spent_tokens - goal.budget_tokens,
        });
      }
    }

    // Check time budget
    if (goal.budget_time_minutes !== undefined && goal.budget_time_minutes !== null) {
      if (goal.spent_time_minutes > goal.budget_time_minutes) {
        violations.push({
          type: 'time',
          limit: goal.budget_time_minutes,
          current: goal.spent_time_minutes,
          overage: goal.spent_time_minutes - goal.budget_time_minutes,
        });
      }
    }

    // Check cost budget
    if (goal.budget_cost_usd !== undefined && goal.budget_cost_usd !== null) {
      if (goal.spent_cost_usd > goal.budget_cost_usd) {
        violations.push({
          type: 'cost',
          limit: goal.budget_cost_usd,
          current: goal.spent_cost_usd,
          overage: goal.spent_cost_usd - goal.budget_cost_usd,
        });
      }
    }

    return {
      withinBudget: violations.length === 0,
      violations,
    };
  }

  /**
   * Get remaining budget info
   */
  getRemainingBudget(goal: Goal): BudgetInfo {
    return {
      tokens: {
        limit: goal.budget_tokens ?? undefined,
        spent: goal.spent_tokens,
        remaining: goal.budget_tokens !== undefined && goal.budget_tokens !== null
          ? Math.max(0, goal.budget_tokens - goal.spent_tokens)
          : undefined,
      },
      time: {
        limitMinutes: goal.budget_time_minutes ?? undefined,
        spentMinutes: goal.spent_time_minutes,
        remainingMinutes: goal.budget_time_minutes !== undefined && goal.budget_time_minutes !== null
          ? Math.max(0, goal.budget_time_minutes - goal.spent_time_minutes)
          : undefined,
      },
      cost: {
        limitUsd: goal.budget_cost_usd ?? undefined,
        spentUsd: goal.spent_cost_usd,
        remainingUsd: goal.budget_cost_usd !== undefined && goal.budget_cost_usd !== null
          ? Math.max(0, goal.budget_cost_usd - goal.spent_cost_usd)
          : undefined,
      },
    };
  }

  /**
   * Get budget status with warning level
   */
  getBudgetStatus(goal: Goal): BudgetStatus {
    const budget = this.getRemainingBudget(goal);
    const checkResult = this.checkBudget(goal);

    // Determine overall warning level (highest of all budget types)
    const tokenWarning = this.getWarningLevel(goal.budget_tokens ?? undefined, goal.spent_tokens);
    const timeWarning = this.getWarningLevel(goal.budget_time_minutes ?? undefined, goal.spent_time_minutes);
    const costWarning = this.getWarningLevel(goal.budget_cost_usd ?? undefined, goal.spent_cost_usd);

    const warningLevel = this.getHighestWarningLevel([tokenWarning, timeWarning, costWarning]);

    return {
      goalId: goal.id,
      budget,
      warningLevel,
      checkResult,
    };
  }

  /**
   * Get warning level for a budget type
   */
  getWarningLevel(limit: number | undefined, spent: number): BudgetWarningLevel {
    if (limit === undefined || limit === null) {
      return 'none';
    }

    if (limit === 0) {
      return spent > 0 ? 'exceeded' : 'none';
    }

    const ratio = spent / limit;

    if (ratio >= 1) {
      return 'exceeded';
    }
    if (ratio >= this.config.thresholds.criticalThreshold) {
      return 'critical';
    }
    if (ratio >= this.config.thresholds.warningThreshold) {
      return 'warning';
    }
    return 'none';
  }

  /**
   * Get the highest warning level from a list
   */
  private getHighestWarningLevel(levels: BudgetWarningLevel[]): BudgetWarningLevel {
    const priority: Record<BudgetWarningLevel, number> = {
      'none': 0,
      'warning': 1,
      'critical': 2,
      'exceeded': 3,
    };

    let highest: BudgetWarningLevel = 'none';
    for (const level of levels) {
      if (priority[level] > priority[highest]) {
        highest = level;
      }
    }
    return highest;
  }

  /**
   * Record resource usage
   * Note: This method is async to support database updates
   */
  async recordUsage(goalId: string, tokens: number, timeSeconds: number, costUsd: number): Promise<void> {
    const callback = this.usageCallbacks.get(goalId);
    if (callback) {
      await callback(tokens, timeSeconds, costUsd);
    }
  }

  /**
   * Register a callback for recording usage to persistent storage
   */
  registerUsageCallback(
    goalId: string,
    callback: (tokens: number, timeSeconds: number, costUsd: number) => Promise<void>
  ): void {
    this.usageCallbacks.set(goalId, callback);
  }

  /**
   * Unregister usage callback
   */
  unregisterUsageCallback(goalId: string): void {
    this.usageCallbacks.delete(goalId);
  }

  /**
   * Estimate if operation will exceed budget
   */
  willExceedBudget(goal: Goal, estimatedTokens: number, estimatedCostUsd: number): boolean {
    // Check token budget
    if (goal.budget_tokens !== undefined && goal.budget_tokens !== null) {
      const projectedTokens = goal.spent_tokens + estimatedTokens;
      const maxAllowed = this.config.allowOverage
        ? goal.budget_tokens * (1 + this.config.maxOveragePercent)
        : goal.budget_tokens;

      if (projectedTokens > maxAllowed) {
        return true;
      }
    }

    // Check cost budget
    if (goal.budget_cost_usd !== undefined && goal.budget_cost_usd !== null) {
      const projectedCost = goal.spent_cost_usd + estimatedCostUsd;
      const maxAllowed = this.config.allowOverage
        ? goal.budget_cost_usd * (1 + this.config.maxOveragePercent)
        : goal.budget_cost_usd;

      if (projectedCost > maxAllowed) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate percentage of budget used
   */
  getUsagePercentage(goal: Goal): { tokens?: number; time?: number; cost?: number } {
    return {
      tokens: goal.budget_tokens ? (goal.spent_tokens / goal.budget_tokens) * 100 : undefined,
      time: goal.budget_time_minutes ? (goal.spent_time_minutes / goal.budget_time_minutes) * 100 : undefined,
      cost: goal.budget_cost_usd ? (goal.spent_cost_usd / goal.budget_cost_usd) * 100 : undefined,
    };
  }

  /**
   * Format budget info for display
   */
  formatBudgetInfo(budget: BudgetInfo): string {
    const parts: string[] = [];

    if (budget.tokens.limit !== undefined) {
      parts.push(`Tokens: ${budget.tokens.spent}/${budget.tokens.limit} (${budget.tokens.remaining} remaining)`);
    } else {
      parts.push(`Tokens: ${budget.tokens.spent} (no limit)`);
    }

    if (budget.time.limitMinutes !== undefined) {
      parts.push(`Time: ${budget.time.spentMinutes}/${budget.time.limitMinutes}min (${budget.time.remainingMinutes}min remaining)`);
    } else {
      parts.push(`Time: ${budget.time.spentMinutes}min (no limit)`);
    }

    if (budget.cost.limitUsd !== undefined) {
      parts.push(`Cost: $${budget.cost.spentUsd.toFixed(4)}/$${budget.cost.limitUsd.toFixed(2)} ($${budget.cost.remainingUsd?.toFixed(4)} remaining)`);
    } else {
      parts.push(`Cost: $${budget.cost.spentUsd.toFixed(4)} (no limit)`);
    }

    return parts.join('\n');
  }
}
