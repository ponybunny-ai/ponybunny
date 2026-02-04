import { BudgetTracker } from '../../../src/scheduler/budget-tracker/budget-tracker.js';
import type { Goal } from '../../../src/work-order/types/index.js';

describe('BudgetTracker', () => {
  let tracker: BudgetTracker;

  const createGoal = (overrides: Partial<Goal> = {}): Goal => ({
    id: 'goal-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 'Test Goal',
    description: 'Test description',
    success_criteria: [],
    status: 'active',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    ...overrides,
  });

  beforeEach(() => {
    tracker = new BudgetTracker();
  });

  describe('checkBudget', () => {
    it('should return within budget when no limits set', () => {
      const goal = createGoal({
        spent_tokens: 1000,
        spent_time_minutes: 60,
        spent_cost_usd: 10,
      });

      const result = tracker.checkBudget(goal);

      expect(result.withinBudget).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should return within budget when under limits', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        budget_time_minutes: 120,
        budget_cost_usd: 50,
        spent_tokens: 5000,
        spent_time_minutes: 60,
        spent_cost_usd: 25,
      });

      const result = tracker.checkBudget(goal);

      expect(result.withinBudget).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect token budget violation', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        spent_tokens: 15000,
      });

      const result = tracker.checkBudget(goal);

      expect(result.withinBudget).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('tokens');
      expect(result.violations[0].overage).toBe(5000);
    });

    it('should detect time budget violation', () => {
      const goal = createGoal({
        budget_time_minutes: 60,
        spent_time_minutes: 90,
      });

      const result = tracker.checkBudget(goal);

      expect(result.withinBudget).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('time');
      expect(result.violations[0].overage).toBe(30);
    });

    it('should detect cost budget violation', () => {
      const goal = createGoal({
        budget_cost_usd: 10,
        spent_cost_usd: 15,
      });

      const result = tracker.checkBudget(goal);

      expect(result.withinBudget).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('cost');
      expect(result.violations[0].overage).toBe(5);
    });

    it('should detect multiple violations', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        budget_cost_usd: 10,
        spent_tokens: 15000,
        spent_cost_usd: 15,
      });

      const result = tracker.checkBudget(goal);

      expect(result.withinBudget).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe('getRemainingBudget', () => {
    it('should calculate remaining budget correctly', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        budget_time_minutes: 120,
        budget_cost_usd: 50,
        spent_tokens: 3000,
        spent_time_minutes: 30,
        spent_cost_usd: 10,
      });

      const budget = tracker.getRemainingBudget(goal);

      expect(budget.tokens.remaining).toBe(7000);
      expect(budget.time.remainingMinutes).toBe(90);
      expect(budget.cost.remainingUsd).toBe(40);
    });

    it('should return undefined remaining when no limit', () => {
      const goal = createGoal({
        spent_tokens: 3000,
      });

      const budget = tracker.getRemainingBudget(goal);

      expect(budget.tokens.limit).toBeUndefined();
      expect(budget.tokens.remaining).toBeUndefined();
      expect(budget.tokens.spent).toBe(3000);
    });

    it('should not return negative remaining', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        spent_tokens: 15000,
      });

      const budget = tracker.getRemainingBudget(goal);

      expect(budget.tokens.remaining).toBe(0);
    });
  });

  describe('getWarningLevel', () => {
    it('should return none when no limit', () => {
      expect(tracker.getWarningLevel(undefined, 1000)).toBe('none');
    });

    it('should return none when under warning threshold', () => {
      expect(tracker.getWarningLevel(10000, 5000)).toBe('none'); // 50%
    });

    it('should return warning at 70%', () => {
      expect(tracker.getWarningLevel(10000, 7500)).toBe('warning'); // 75%
    });

    it('should return critical at 90%', () => {
      expect(tracker.getWarningLevel(10000, 9500)).toBe('critical'); // 95%
    });

    it('should return exceeded at 100%+', () => {
      expect(tracker.getWarningLevel(10000, 10000)).toBe('exceeded');
      expect(tracker.getWarningLevel(10000, 15000)).toBe('exceeded');
    });
  });

  describe('getBudgetStatus', () => {
    it('should return complete status', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        spent_tokens: 8000,
      });

      const status = tracker.getBudgetStatus(goal);

      expect(status.goalId).toBe('goal-1');
      expect(status.warningLevel).toBe('warning');
      expect(status.checkResult.withinBudget).toBe(true);
    });

    it('should use highest warning level', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        budget_cost_usd: 100,
        spent_tokens: 5000, // 50% - none
        spent_cost_usd: 95, // 95% - critical
      });

      const status = tracker.getBudgetStatus(goal);

      expect(status.warningLevel).toBe('critical');
    });
  });

  describe('willExceedBudget', () => {
    it('should return false when no limits', () => {
      const goal = createGoal();

      expect(tracker.willExceedBudget(goal, 10000, 100)).toBe(false);
    });

    it('should return false when within budget', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        spent_tokens: 5000,
      });

      expect(tracker.willExceedBudget(goal, 3000, 0)).toBe(false);
    });

    it('should return true when will exceed tokens', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        spent_tokens: 8000,
      });

      expect(tracker.willExceedBudget(goal, 5000, 0)).toBe(true);
    });

    it('should return true when will exceed cost', () => {
      const goal = createGoal({
        budget_cost_usd: 10,
        spent_cost_usd: 8,
      });

      expect(tracker.willExceedBudget(goal, 0, 5)).toBe(true);
    });
  });

  describe('custom thresholds', () => {
    it('should use custom warning thresholds', () => {
      const customTracker = new BudgetTracker({
        thresholds: {
          warningThreshold: 0.5,
          criticalThreshold: 0.8,
        },
      });

      expect(customTracker.getWarningLevel(10000, 6000)).toBe('warning'); // 60%
      expect(customTracker.getWarningLevel(10000, 8500)).toBe('critical'); // 85%
    });
  });

  describe('usage callbacks', () => {
    it('should call registered callback on recordUsage', async () => {
      const callback = jest.fn().mockResolvedValue(undefined);
      tracker.registerUsageCallback('goal-1', callback);

      await tracker.recordUsage('goal-1', 1000, 60, 5);

      expect(callback).toHaveBeenCalledWith(1000, 60, 5);
    });

    it('should not fail when no callback registered', async () => {
      await expect(tracker.recordUsage('goal-1', 1000, 60, 5)).resolves.not.toThrow();
    });

    it('should unregister callback', async () => {
      const callback = jest.fn().mockResolvedValue(undefined);
      tracker.registerUsageCallback('goal-1', callback);
      tracker.unregisterUsageCallback('goal-1');

      await tracker.recordUsage('goal-1', 1000, 60, 5);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('formatBudgetInfo', () => {
    it('should format budget info with limits', () => {
      const goal = createGoal({
        budget_tokens: 10000,
        budget_time_minutes: 60,
        budget_cost_usd: 10,
        spent_tokens: 5000,
        spent_time_minutes: 30,
        spent_cost_usd: 5,
      });

      const budget = tracker.getRemainingBudget(goal);
      const formatted = tracker.formatBudgetInfo(budget);

      expect(formatted).toContain('Tokens: 5000/10000');
      expect(formatted).toContain('Time: 30/60min');
      expect(formatted).toContain('Cost:');
    });

    it('should format budget info without limits', () => {
      const goal = createGoal({
        spent_tokens: 5000,
      });

      const budget = tracker.getRemainingBudget(goal);
      const formatted = tracker.formatBudgetInfo(budget);

      expect(formatted).toContain('no limit');
    });
  });
});
