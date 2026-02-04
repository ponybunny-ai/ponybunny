/**
 * Budget Tracker Types
 */

import type { BudgetInfo, BudgetCheckResult } from '../types.js';
import type { Goal } from '../../work-order/types/index.js';

export interface BudgetWarningThresholds {
  /** Warn when this percentage of budget is used (0-1) */
  warningThreshold: number;
  /** Critical warning threshold (0-1) */
  criticalThreshold: number;
}

export interface BudgetTrackerConfig {
  thresholds: BudgetWarningThresholds;
  /** Whether to allow exceeding budget (with escalation) */
  allowOverage: boolean;
  /** Maximum overage percentage allowed (0-1) */
  maxOveragePercent: number;
}

export type BudgetWarningLevel = 'none' | 'warning' | 'critical' | 'exceeded';

export interface BudgetStatus {
  goalId: string;
  budget: BudgetInfo;
  warningLevel: BudgetWarningLevel;
  checkResult: BudgetCheckResult;
}

export interface IBudgetTracker {
  /** Check if goal is within budget */
  checkBudget(goal: Goal): BudgetCheckResult;

  /** Get remaining budget info */
  getRemainingBudget(goal: Goal): BudgetInfo;

  /** Get budget status with warning level */
  getBudgetStatus(goal: Goal): BudgetStatus;

  /** Record resource usage */
  recordUsage(goalId: string, tokens: number, timeSeconds: number, costUsd: number): Promise<void>;

  /** Estimate if operation will exceed budget */
  willExceedBudget(goal: Goal, estimatedTokens: number, estimatedCostUsd: number): boolean;

  /** Get warning level for a budget type */
  getWarningLevel(limit: number | undefined, spent: number): BudgetWarningLevel;
}
