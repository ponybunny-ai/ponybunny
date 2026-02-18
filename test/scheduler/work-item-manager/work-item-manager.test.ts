import { WorkItemManager } from '../../../src/scheduler/work-item-manager/work-item-manager.js';
import type { IWorkItemRepository } from '../../../src/scheduler/work-item-manager/work-item-manager.js';
import type { WorkItem, WorkItemStatus } from '../../../src/work-order/types/index.js';

describe('WorkItemManager', () => {
  let manager: WorkItemManager;
  let mockRepository: jest.Mocked<IWorkItemRepository>;
  let workItems: Map<string, WorkItem>;

  const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
    id: `wi-${Math.random().toString(36).substring(2, 11)}`,
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'Test description',
    item_type: 'code',
    status: 'queued',
    priority: 50,
    dependencies: [],
    blocks: [],
    estimated_effort: 'M',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    ...overrides,
  });

  beforeEach(() => {
    workItems = new Map();

    mockRepository = {
      getWorkItem: jest.fn((id: string) => workItems.get(id)),
      getWorkItemsByGoal: jest.fn((goalId: string) =>
        Array.from(workItems.values()).filter((item) => item.goal_id === goalId)
      ),
      updateWorkItemStatus: jest.fn((id: string, status: WorkItemStatus) => {
        const item = workItems.get(id);
        if (item) {
          workItems.set(id, { ...item, status, updated_at: Date.now() });
        }
      }),
      updateWorkItemStatusIfDependenciesMet: jest.fn((id: string) => {
        const item = workItems.get(id);
        if (!item || item.status !== 'queued') {
          return;
        }

        const allDependenciesCompleted = (item.dependencies || []).every((depId) => {
          const dep = workItems.get(depId);
          return dep?.status === 'done';
        });

        if (allDependenciesCompleted) {
          workItems.set(id, { ...item, status: 'ready', updated_at: Date.now() });
        }
      }),
    };

    manager = new WorkItemManager(mockRepository);
  });

  describe('getReadyWorkItems', () => {
    it('should return items with ready status', async () => {
      const item1 = createWorkItem({ id: 'wi-1', status: 'ready', priority: 50 });
      const item2 = createWorkItem({ id: 'wi-2', status: 'queued', priority: 50 });
      const item3 = createWorkItem({ id: 'wi-3', status: 'ready', priority: 60 });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);
      workItems.set('wi-3', item3);

      const ready = await manager.getReadyWorkItems('goal-1');

      expect(ready).toHaveLength(3); // wi-2 has no deps so it's also ready
      expect(ready[0].id).toBe('wi-3'); // Higher priority first
    });

    it('should transition queued items with satisfied dependencies to ready', async () => {
      const item = createWorkItem({ id: 'wi-1', status: 'queued' });
      workItems.set('wi-1', item);

      const ready = await manager.getReadyWorkItems('goal-1');

      expect(mockRepository.updateWorkItemStatusIfDependenciesMet).toHaveBeenCalledWith('wi-1');
      expect(ready).toHaveLength(1);
      expect(ready[0].status).toBe('ready');
      expect(workItems.get('wi-1')?.status).toBe('ready');
    });

    it('should include queued items with satisfied dependencies', async () => {
      const dep = createWorkItem({ id: 'wi-dep', status: 'done' });
      const item = createWorkItem({
        id: 'wi-1',
        status: 'queued',
        dependencies: ['wi-dep'],
      });
      workItems.set('wi-dep', dep);
      workItems.set('wi-1', item);

      const ready = await manager.getReadyWorkItems('goal-1');

      expect(ready.map((i) => i.id)).toContain('wi-1');
    });

    it('should not include queued items with unsatisfied dependencies', async () => {
      const dep = createWorkItem({ id: 'wi-dep', status: 'in_progress' });
      const item = createWorkItem({
        id: 'wi-1',
        status: 'queued',
        dependencies: ['wi-dep'],
      });
      workItems.set('wi-dep', dep);
      workItems.set('wi-1', item);

      const ready = await manager.getReadyWorkItems('goal-1');

      expect(ready.map((i) => i.id)).not.toContain('wi-1');
    });

    it('should sort by priority then creation time', async () => {
      const item1 = createWorkItem({
        id: 'wi-1',
        status: 'ready',
        priority: 50,
        created_at: 1000,
      });
      const item2 = createWorkItem({
        id: 'wi-2',
        status: 'ready',
        priority: 50,
        created_at: 500,
      });
      const item3 = createWorkItem({
        id: 'wi-3',
        status: 'ready',
        priority: 100,
        created_at: 2000,
      });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);
      workItems.set('wi-3', item3);

      const ready = await manager.getReadyWorkItems('goal-1');

      expect(ready[0].id).toBe('wi-3'); // Highest priority
      expect(ready[1].id).toBe('wi-2'); // Same priority, older
      expect(ready[2].id).toBe('wi-1'); // Same priority, newer
    });
  });

  describe('areDependenciesSatisfied', () => {
    it('should return true when no dependencies', async () => {
      const item = createWorkItem({ dependencies: [] });

      const satisfied = await manager.areDependenciesSatisfied(item);

      expect(satisfied).toBe(true);
    });

    it('should return true when all dependencies are done', async () => {
      const dep1 = createWorkItem({ id: 'dep-1', status: 'done' });
      const dep2 = createWorkItem({ id: 'dep-2', status: 'done' });
      const item = createWorkItem({ dependencies: ['dep-1', 'dep-2'] });
      workItems.set('dep-1', dep1);
      workItems.set('dep-2', dep2);

      const satisfied = await manager.areDependenciesSatisfied(item);

      expect(satisfied).toBe(true);
    });

    it('should return false when any dependency is not done', async () => {
      const dep1 = createWorkItem({ id: 'dep-1', status: 'done' });
      const dep2 = createWorkItem({ id: 'dep-2', status: 'in_progress' });
      const item = createWorkItem({ dependencies: ['dep-1', 'dep-2'] });
      workItems.set('dep-1', dep1);
      workItems.set('dep-2', dep2);

      const satisfied = await manager.areDependenciesSatisfied(item);

      expect(satisfied).toBe(false);
    });

    it('should return false when dependency is missing', async () => {
      const item = createWorkItem({ dependencies: ['missing-dep'] });

      const satisfied = await manager.areDependenciesSatisfied(item);

      expect(satisfied).toBe(false);
    });
  });

  describe('getDependencyStatus', () => {
    it('should categorize dependencies correctly', async () => {
      const dep1 = createWorkItem({ id: 'dep-1', status: 'done' });
      const dep2 = createWorkItem({ id: 'dep-2', status: 'in_progress' });
      const dep3 = createWorkItem({ id: 'dep-3', status: 'failed' });
      const item = createWorkItem({
        id: 'wi-1',
        dependencies: ['dep-1', 'dep-2', 'dep-3', 'dep-missing'],
      });
      workItems.set('dep-1', dep1);
      workItems.set('dep-2', dep2);
      workItems.set('dep-3', dep3);

      const status = await manager.getDependencyStatus(item);

      expect(status.workItemId).toBe('wi-1');
      expect(status.satisfied).toBe(false);
      expect(status.completedDependencies).toEqual(['dep-1']);
      expect(status.pendingDependencies).toContain('dep-2');
      expect(status.pendingDependencies).toContain('dep-missing');
      expect(status.failedDependencies).toEqual(['dep-3']);
    });

    it('should return satisfied when all deps complete', async () => {
      const dep = createWorkItem({ id: 'dep-1', status: 'done' });
      const item = createWorkItem({ id: 'wi-1', dependencies: ['dep-1'] });
      workItems.set('dep-1', dep);

      const status = await manager.getDependencyStatus(item);

      expect(status.satisfied).toBe(true);
    });
  });

  describe('updateStatus', () => {
    it('should update status for valid transition', async () => {
      const item = createWorkItem({ id: 'wi-1', status: 'queued' });
      workItems.set('wi-1', item);

      await manager.updateStatus('wi-1', 'ready');

      expect(mockRepository.updateWorkItemStatus).toHaveBeenCalledWith('wi-1', 'ready');
    });

    it('should throw for invalid transition', async () => {
      const item = createWorkItem({ id: 'wi-1', status: 'done' });
      workItems.set('wi-1', item);

      await expect(manager.updateStatus('wi-1', 'queued')).rejects.toThrow(
        'Invalid status transition'
      );
    });

    it('should throw for non-existent work item', async () => {
      await expect(manager.updateStatus('non-existent', 'ready')).rejects.toThrow(
        'Work item not found'
      );
    });

    it('should record transition history', async () => {
      const item = createWorkItem({ id: 'wi-1', status: 'queued' });
      workItems.set('wi-1', item);

      await manager.updateStatus('wi-1', 'ready', 'Dependencies satisfied');

      const history = manager.getTransitionHistory('wi-1');
      expect(history).toHaveLength(1);
      expect(history[0].fromStatus).toBe('queued');
      expect(history[0].toStatus).toBe('ready');
      expect(history[0].reason).toBe('Dependencies satisfied');
    });

    it('should unblock dependents when item completes', async () => {
      const dep = createWorkItem({ id: 'wi-dep', status: 'in_progress' });
      const blocked = createWorkItem({
        id: 'wi-blocked',
        status: 'queued',
        dependencies: ['wi-dep'],
      });
      workItems.set('wi-dep', dep);
      workItems.set('wi-blocked', blocked);

      await manager.updateStatus('wi-dep', 'done');

      // The blocked item should now be ready
      expect(mockRepository.updateWorkItemStatus).toHaveBeenCalledWith('wi-blocked', 'ready');
    });
  });

  describe('getBlockedWorkItems', () => {
    it('should return only blocked items', async () => {
      const item1 = createWorkItem({ id: 'wi-1', status: 'blocked' });
      const item2 = createWorkItem({ id: 'wi-2', status: 'ready' });
      const item3 = createWorkItem({ id: 'wi-3', status: 'blocked' });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);
      workItems.set('wi-3', item3);

      const blocked = await manager.getBlockedWorkItems('goal-1');

      expect(blocked).toHaveLength(2);
      expect(blocked.map((i) => i.id)).toContain('wi-1');
      expect(blocked.map((i) => i.id)).toContain('wi-3');
    });
  });

  describe('getWorkItemsByStatus', () => {
    it('should filter by status', async () => {
      const item1 = createWorkItem({ id: 'wi-1', status: 'in_progress' });
      const item2 = createWorkItem({ id: 'wi-2', status: 'ready' });
      const item3 = createWorkItem({ id: 'wi-3', status: 'in_progress' });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);
      workItems.set('wi-3', item3);

      const inProgress = await manager.getWorkItemsByStatus('goal-1', 'in_progress');

      expect(inProgress).toHaveLength(2);
      expect(inProgress.map((i) => i.id)).toContain('wi-1');
      expect(inProgress.map((i) => i.id)).toContain('wi-3');
    });
  });

  describe('validateDAG', () => {
    it('should return valid for acyclic graph', async () => {
      const item1 = createWorkItem({ id: 'wi-1', dependencies: [] });
      const item2 = createWorkItem({ id: 'wi-2', dependencies: ['wi-1'] });
      const item3 = createWorkItem({ id: 'wi-3', dependencies: ['wi-1', 'wi-2'] });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);
      workItems.set('wi-3', item3);

      const result = await manager.validateDAG('goal-1');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing dependencies', async () => {
      const item = createWorkItem({ id: 'wi-1', dependencies: ['missing-dep'] });
      workItems.set('wi-1', item);

      const result = await manager.validateDAG('goal-1');

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('missing dependency');
    });

    it('should detect cycles', async () => {
      const item1 = createWorkItem({ id: 'wi-1', dependencies: ['wi-3'] });
      const item2 = createWorkItem({ id: 'wi-2', dependencies: ['wi-1'] });
      const item3 = createWorkItem({ id: 'wi-3', dependencies: ['wi-2'] });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);
      workItems.set('wi-3', item3);

      const result = await manager.validateDAG('goal-1');

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Cycle detected'))).toBe(true);
      expect(result.cycles).toBeDefined();
    });

    it('should return valid for empty goal', async () => {
      const result = await manager.validateDAG('empty-goal');

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('getWorkItem', () => {
    it('should return work item by id', async () => {
      const item = createWorkItem({ id: 'wi-1' });
      workItems.set('wi-1', item);

      const result = await manager.getWorkItem('wi-1');

      expect(result).toEqual(item);
    });

    it('should return null for non-existent item', async () => {
      const result = await manager.getWorkItem('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getWorkItemsForGoal', () => {
    it('should return all items for goal', async () => {
      const item1 = createWorkItem({ id: 'wi-1', goal_id: 'goal-1' });
      const item2 = createWorkItem({ id: 'wi-2', goal_id: 'goal-1' });
      const item3 = createWorkItem({ id: 'wi-3', goal_id: 'goal-2' });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);
      workItems.set('wi-3', item3);

      const result = await manager.getWorkItemsForGoal('goal-1');

      expect(result).toHaveLength(2);
      expect(result.map((i) => i.id)).toContain('wi-1');
      expect(result.map((i) => i.id)).toContain('wi-2');
    });
  });

  describe('areAllWorkItemsComplete', () => {
    it('should return true when all items are done', async () => {
      const item1 = createWorkItem({ id: 'wi-1', status: 'done' });
      const item2 = createWorkItem({ id: 'wi-2', status: 'done' });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);

      const result = await manager.areAllWorkItemsComplete('goal-1');

      expect(result).toBe(true);
    });

    it('should return false when any item is not done', async () => {
      const item1 = createWorkItem({ id: 'wi-1', status: 'done' });
      const item2 = createWorkItem({ id: 'wi-2', status: 'in_progress' });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);

      const result = await manager.areAllWorkItemsComplete('goal-1');

      expect(result).toBe(false);
    });

    it('should return true for empty goal', async () => {
      const result = await manager.areAllWorkItemsComplete('empty-goal');

      expect(result).toBe(true);
    });
  });

  describe('getNextWorkItem', () => {
    it('should return highest priority ready item', async () => {
      const item1 = createWorkItem({ id: 'wi-1', status: 'ready', priority: 50 });
      const item2 = createWorkItem({ id: 'wi-2', status: 'ready', priority: 100 });
      workItems.set('wi-1', item1);
      workItems.set('wi-2', item2);

      const result = await manager.getNextWorkItem('goal-1');

      expect(result?.id).toBe('wi-2');
    });

    it('should return null when no ready items', async () => {
      const item = createWorkItem({ id: 'wi-1', status: 'done' });
      workItems.set('wi-1', item);

      const result = await manager.getNextWorkItem('goal-1');

      expect(result).toBeNull();
    });
  });

  describe('status transitions', () => {
    const validTransitions: Array<[WorkItemStatus, WorkItemStatus]> = [
      ['queued', 'ready'],
      ['queued', 'blocked'],
      ['queued', 'failed'],
      ['ready', 'in_progress'],
      ['ready', 'blocked'],
      ['ready', 'failed'],
      ['in_progress', 'verify'],
      ['in_progress', 'done'],
      ['in_progress', 'failed'],
      ['in_progress', 'blocked'],
      ['verify', 'done'],
      ['verify', 'failed'],
      ['verify', 'in_progress'],
      ['failed', 'queued'],
      ['failed', 'ready'],
      ['blocked', 'queued'],
      ['blocked', 'ready'],
      ['blocked', 'failed'],
    ];

    it.each(validTransitions)(
      'should allow transition from %s to %s',
      async (from, to) => {
        const item = createWorkItem({ id: 'wi-1', status: from });
        workItems.set('wi-1', item);

        await expect(manager.updateStatus('wi-1', to)).resolves.not.toThrow();
      }
    );

    const invalidTransitions: Array<[WorkItemStatus, WorkItemStatus]> = [
      ['done', 'queued'],
      ['done', 'ready'],
      ['done', 'in_progress'],
      ['done', 'failed'],
      ['queued', 'done'],
      ['queued', 'verify'],
      ['ready', 'done'],
      ['ready', 'verify'],
    ];

    it.each(invalidTransitions)(
      'should reject transition from %s to %s',
      async (from, to) => {
        const item = createWorkItem({ id: 'wi-1', status: from });
        workItems.set('wi-1', item);

        await expect(manager.updateStatus('wi-1', to)).rejects.toThrow(
          'Invalid status transition'
        );
      }
    );
  });
});
