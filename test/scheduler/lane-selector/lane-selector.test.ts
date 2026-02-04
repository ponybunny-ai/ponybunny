import { LaneSelector } from '../../../src/scheduler/lane-selector/lane-selector.js';
import type { Goal, WorkItem } from '../../../src/work-order/types/index.js';

describe('LaneSelector', () => {
  let selector: LaneSelector;

  const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'Test description',
    item_type: 'code',
    status: 'ready',
    priority: 1,
    dependencies: [],
    blocks: [],
    estimated_effort: 'M',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    ...overrides,
  });

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
    selector = new LaneSelector();
  });

  describe('selectLane', () => {
    it('should default to main lane for regular tasks', () => {
      const workItem = createWorkItem();
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('main');
      expect(result.reason).toContain('Primary');
    });

    it('should select session lane for interactive tasks', () => {
      const workItem = createWorkItem({
        context: { interactive: true },
      });
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('session');
    });

    it('should select session lane for XL effort tasks', () => {
      const workItem = createWorkItem({
        estimated_effort: 'XL',
      });
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('session');
    });

    it('should select cron lane for scheduled tasks', () => {
      const workItem = createWorkItem({
        context: { scheduled: true },
      });
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('cron');
    });

    it('should select subagent lane for small independent tasks', () => {
      const workItem = createWorkItem({
        estimated_effort: 'S',
        dependencies: [],
      });
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('subagent');
    });

    it('should select subagent lane for analysis tasks', () => {
      const workItem = createWorkItem({
        item_type: 'analysis',
      });
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('subagent');
    });

    it('should respect explicit lane assignment', () => {
      const workItem = createWorkItem({
        context: { lane: 'cron' },
      });
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('cron');
      expect(result.reason).toContain('Explicitly');
    });

    it('should fall back to main when subagent has no capacity', () => {
      // Fill up subagent lane
      selector.incrementActive('subagent');
      selector.incrementActive('subagent');
      selector.incrementActive('subagent');

      const workItem = createWorkItem({
        estimated_effort: 'S',
        dependencies: [],
      });
      const goal = createGoal();

      const result = selector.selectLane(workItem, goal);

      expect(result.laneId).toBe('main');
    });
  });

  describe('lane capacity', () => {
    it('should track active count', () => {
      expect(selector.getLaneStatus('main').activeCount).toBe(0);

      selector.incrementActive('main');
      expect(selector.getLaneStatus('main').activeCount).toBe(1);

      selector.decrementActive('main');
      expect(selector.getLaneStatus('main').activeCount).toBe(0);
    });

    it('should not go below zero', () => {
      selector.decrementActive('main');
      expect(selector.getLaneStatus('main').activeCount).toBe(0);
    });

    it('should check capacity correctly', () => {
      // Main lane has maxConcurrency of 1
      expect(selector.hasCapacity('main')).toBe(true);

      selector.incrementActive('main');
      expect(selector.hasCapacity('main')).toBe(false);
    });

    it('should track queued count', () => {
      selector.incrementQueued('subagent');
      selector.incrementQueued('subagent');

      expect(selector.getLaneStatus('subagent').queuedCount).toBe(2);

      selector.decrementQueued('subagent');
      expect(selector.getLaneStatus('subagent').queuedCount).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should use default configs', () => {
      const mainConfig = selector.getLaneConfig('main');

      expect(mainConfig.maxConcurrency).toBe(1);
      expect(mainConfig.displayName).toBe('Main');
    });

    it('should allow custom configs', () => {
      const customSelector = new LaneSelector({
        main: { maxConcurrency: 2 },
      });

      expect(customSelector.getLaneConfig('main').maxConcurrency).toBe(2);
    });

    it('should get all lane configs', () => {
      const configs = selector.getAllLaneConfigs();

      expect(Object.keys(configs)).toContain('main');
      expect(Object.keys(configs)).toContain('subagent');
      expect(Object.keys(configs)).toContain('cron');
      expect(Object.keys(configs)).toContain('session');
    });

    it('should reset all statuses', () => {
      selector.incrementActive('main');
      selector.incrementActive('subagent');
      selector.incrementQueued('cron');

      selector.reset();

      expect(selector.getLaneStatus('main').activeCount).toBe(0);
      expect(selector.getLaneStatus('subagent').activeCount).toBe(0);
      expect(selector.getLaneStatus('cron').queuedCount).toBe(0);
    });
  });

  describe('availability', () => {
    it('should update availability based on capacity', () => {
      expect(selector.getLaneStatus('main').isAvailable).toBe(true);

      selector.incrementActive('main');
      expect(selector.getLaneStatus('main').isAvailable).toBe(false);

      selector.decrementActive('main');
      expect(selector.getLaneStatus('main').isAvailable).toBe(true);
    });

    it('should allow manual availability control', () => {
      selector.setAvailability('main', false);
      expect(selector.getLaneStatus('main').isAvailable).toBe(false);

      selector.setAvailability('main', true);
      expect(selector.getLaneStatus('main').isAvailable).toBe(true);
    });
  });
});
