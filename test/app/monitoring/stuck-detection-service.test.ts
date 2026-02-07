import { StuckDetectionService, IWorkItemRepository, IRunRepository } from '../../../src/app/monitoring/stuck-detection-service.js';
import type { WorkItem, Run, WorkItemStatus, RunStatus } from '../../../src/work-order/types/index.js';
import type { IStuckDetectionConfig } from '../../../src/domain/stuck/types.js';

// Mock repositories
class MockWorkItemRepository implements IWorkItemRepository {
  private items = new Map<string, WorkItem>();

  addItem(item: WorkItem): void {
    this.items.set(item.id, item);
  }

  getWorkItem(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  getWorkItemsByGoal(goalId: string): WorkItem[] {
    return Array.from(this.items.values()).filter(i => i.goal_id === goalId);
  }

  getWorkItemsByStatus(status: WorkItemStatus): WorkItem[] {
    return Array.from(this.items.values()).filter(i => i.status === status);
  }

  clear(): void {
    this.items.clear();
  }
}

class MockRunRepository implements IRunRepository {
  private runs = new Map<string, Run>();

  addRun(run: Run): void {
    this.runs.set(run.id, run);
  }

  getRun(id: string): Run | undefined {
    return this.runs.get(id);
  }

  getRunsByWorkItem(workItemId: string): Run[] {
    return Array.from(this.runs.values()).filter(r => r.work_item_id === workItemId);
  }

  getRunsByStatus(status: RunStatus): Run[] {
    return Array.from(this.runs.values()).filter(r => r.status === status);
  }

  getRunsByGoal(goalId: string): Run[] {
    return Array.from(this.runs.values()).filter(r => r.goal_id === goalId);
  }

  clear(): void {
    this.runs.clear();
  }
}

function createWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'item-1',
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
  };
}

function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    created_at: Date.now(),
    work_item_id: 'item-1',
    goal_id: 'goal-1',
    agent_type: 'code-agent',
    run_sequence: 1,
    status: 'running',
    tokens_used: 1000,
    cost_usd: 0.01,
    artifacts: [],
    ...overrides,
  };
}

describe('StuckDetectionService', () => {
  let workItemRepo: MockWorkItemRepository;
  let runRepo: MockRunRepository;
  let service: StuckDetectionService;
  const testConfig: Partial<IStuckDetectionConfig> = {
    maxInProgressDurationMs: 1000,      // 1 second for testing
    maxReadyDurationMs: 2000,           // 2 seconds for testing
    maxSameErrorRetries: 2,
    maxTotalRetries: 3,
    checkIntervalMs: 0,                 // No throttle for tests
  };

  beforeEach(() => {
    workItemRepo = new MockWorkItemRepository();
    runRepo = new MockRunRepository();
    service = new StuckDetectionService(workItemRepo, runRepo, testConfig);
  });

  describe('checkWorkItem', () => {
    it('should return null for non-existent work item', async () => {
      const result = await service.checkWorkItem('non-existent');
      expect(result).toBeNull();
    });

    it('should detect timeout_in_progress', async () => {
      const item = createWorkItem({
        id: 'item-1',
        status: 'in_progress',
        updated_at: Date.now() - 2000, // 2 seconds ago
      });
      workItemRepo.addItem(item);

      const result = await service.checkWorkItem('item-1');

      expect(result).not.toBeNull();
      expect(result!.reason).toBe('timeout_in_progress');
      expect(result!.suggestedActions).toContain('increase_timeout');
    });

    it('should detect timeout_ready', async () => {
      const item = createWorkItem({
        id: 'item-1',
        status: 'ready',
        updated_at: Date.now() - 3000, // 3 seconds ago
      });
      workItemRepo.addItem(item);

      const result = await service.checkWorkItem('item-1');

      expect(result).not.toBeNull();
      expect(result!.reason).toBe('timeout_ready');
      expect(result!.suggestedActions).toContain('reassign');
    });

    it('should detect max_retries_exceeded', async () => {
      const item = createWorkItem({
        id: 'item-1',
        status: 'failed',
        retry_count: 3,
        max_retries: 3,
      });
      workItemRepo.addItem(item);

      const result = await service.checkWorkItem('item-1');

      expect(result).not.toBeNull();
      expect(result!.reason).toBe('max_retries_exceeded');
      expect(result!.suggestedActions).toContain('escalate');
    });

    it('should detect missing_dependency', async () => {
      const item = createWorkItem({
        id: 'item-1',
        status: 'blocked',
        dependencies: ['non-existent-dep'],
      });
      workItemRepo.addItem(item);

      const result = await service.checkWorkItem('item-1');

      expect(result).not.toBeNull();
      expect(result!.reason).toBe('missing_dependency');
    });

    it('should detect repeated_same_error', async () => {
      const item = createWorkItem({ id: 'item-1', status: 'failed' });
      workItemRepo.addItem(item);

      // Add failed runs with same error signature
      for (let i = 0; i < 3; i++) {
        runRepo.addRun(createRun({
          id: `run-${i}`,
          work_item_id: 'item-1',
          status: 'failure',
          error_signature: 'SYNTAX_ERROR_001',
          completed_at: Date.now() - (3 - i) * 1000,
        }));
      }

      const result = await service.checkWorkItem('item-1');

      expect(result).not.toBeNull();
      expect(result!.reason).toBe('repeated_same_error');
      expect(result!.errorSignature).toBe('SYNTAX_ERROR_001');
    });

    it('should not flag item with different errors', async () => {
      const item = createWorkItem({ id: 'item-1', status: 'failed' });
      workItemRepo.addItem(item);

      // Add failed runs with different error signatures
      runRepo.addRun(createRun({
        id: 'run-1',
        work_item_id: 'item-1',
        status: 'failure',
        error_signature: 'ERROR_A',
      }));
      runRepo.addRun(createRun({
        id: 'run-2',
        work_item_id: 'item-1',
        status: 'failure',
        error_signature: 'ERROR_B',
      }));

      const result = await service.checkWorkItem('item-1');

      // Should not be stuck due to repeated errors (each appears only once)
      expect(result?.reason).not.toBe('repeated_same_error');
    });
  });

  describe('checkRun', () => {
    it('should return null for non-existent run', async () => {
      const result = await service.checkRun('non-existent');
      expect(result).toBeNull();
    });

    it('should return null for completed run', async () => {
      runRepo.addRun(createRun({
        id: 'run-1',
        status: 'success',
      }));

      const result = await service.checkRun('run-1');
      expect(result).toBeNull();
    });

    it('should detect run_timeout', async () => {
      runRepo.addRun(createRun({
        id: 'run-1',
        status: 'running',
        created_at: Date.now() - 2000, // 2 seconds ago (> 1 second config)
      }));

      const result = await service.checkRun('run-1');

      expect(result).not.toBeNull();
      expect(result!.reason).toBe('run_timeout');
    });
  });

  describe('checkAllWorkItems', () => {
    it('should check all active work items', async () => {
      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        status: 'in_progress',
        updated_at: Date.now() - 2000,
      }));
      workItemRepo.addItem(createWorkItem({
        id: 'item-2',
        status: 'ready',
        updated_at: Date.now() - 3000,
      }));
      workItemRepo.addItem(createWorkItem({
        id: 'item-3',
        status: 'done', // Should not be checked
      }));

      const results = await service.checkAllWorkItems();

      expect(results.length).toBe(2);
      expect(results.map(r => r.workItemId)).toContain('item-1');
      expect(results.map(r => r.workItemId)).toContain('item-2');
    });

    it('should filter by goalId', async () => {
      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        goal_id: 'goal-1',
        status: 'in_progress',
        updated_at: Date.now() - 2000,
      }));
      workItemRepo.addItem(createWorkItem({
        id: 'item-2',
        goal_id: 'goal-2',
        status: 'in_progress',
        updated_at: Date.now() - 2000,
      }));

      const results = await service.checkAllWorkItems('goal-1');

      expect(results.length).toBe(1);
      expect(results[0].workItemId).toBe('item-1');
    });

    it('should skip acknowledged items', async () => {
      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        status: 'in_progress',
        updated_at: Date.now() - 2000,
      }));

      service.acknowledgeStuck('item-1', 60000);

      const results = await service.checkAllWorkItems();

      expect(results.length).toBe(0);
    });
  });

  describe('detectCircularDependencies', () => {
    it('should detect simple cycle', async () => {
      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        goal_id: 'goal-1',
        dependencies: ['item-2'],
      }));
      workItemRepo.addItem(createWorkItem({
        id: 'item-2',
        goal_id: 'goal-1',
        dependencies: ['item-1'],
      }));

      const cycles = await service.detectCircularDependencies('goal-1');

      expect(cycles.length).toBeGreaterThan(0);
    });

    it('should detect no cycles in valid DAG', async () => {
      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        goal_id: 'goal-1',
        dependencies: [],
      }));
      workItemRepo.addItem(createWorkItem({
        id: 'item-2',
        goal_id: 'goal-1',
        dependencies: ['item-1'],
      }));
      workItemRepo.addItem(createWorkItem({
        id: 'item-3',
        goal_id: 'goal-1',
        dependencies: ['item-1', 'item-2'],
      }));

      const cycles = await service.detectCircularDependencies('goal-1');

      expect(cycles.length).toBe(0);
    });
  });

  describe('analyzeErrorPatterns', () => {
    it('should count error signatures', async () => {
      workItemRepo.addItem(createWorkItem({ id: 'item-1' }));

      runRepo.addRun(createRun({
        id: 'run-1',
        work_item_id: 'item-1',
        status: 'failure',
        error_signature: 'ERROR_A',
        completed_at: Date.now() - 2000,
      }));
      runRepo.addRun(createRun({
        id: 'run-2',
        work_item_id: 'item-1',
        status: 'failure',
        error_signature: 'ERROR_A',
        completed_at: Date.now() - 1000,
      }));
      runRepo.addRun(createRun({
        id: 'run-3',
        work_item_id: 'item-1',
        status: 'failure',
        error_signature: 'ERROR_B',
        completed_at: Date.now(),
      }));

      const result = await service.analyzeErrorPatterns('item-1');

      expect(result.patterns.length).toBe(2);
      expect(result.patterns[0].signature).toBe('ERROR_A');
      expect(result.patterns[0].count).toBe(2);
      expect(result.isRepeating).toBe(true);
    });

    it('should suggest fix for timeout errors', async () => {
      workItemRepo.addItem(createWorkItem({ id: 'item-1' }));

      for (let i = 0; i < 3; i++) {
        runRepo.addRun(createRun({
          id: `run-${i}`,
          work_item_id: 'item-1',
          status: 'failure',
          error_signature: 'timeout_exceeded',  // lowercase to match pattern
          completed_at: Date.now() - i * 1000,
        }));
      }

      const result = await service.analyzeErrorPatterns('item-1');

      expect(result.suggestedFix).toContain('timeout');
    });
  });

  describe('acknowledgeStuck', () => {
    it('should suppress detection for acknowledged items', async () => {
      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        status: 'in_progress',
        updated_at: Date.now() - 2000,
      }));

      // First check should detect stuck
      const result1 = await service.checkWorkItem('item-1');
      expect(result1).not.toBeNull();

      // Acknowledge
      service.acknowledgeStuck('item-1', 60000);

      // Check all should skip acknowledged
      const allResults = await service.checkAllWorkItems();
      expect(allResults.length).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should return current config', () => {
      const config = service.getConfig();

      expect(config.maxInProgressDurationMs).toBe(1000);
      expect(config.maxTotalRetries).toBe(3);
    });

    it('should update config', () => {
      service.updateConfig({ maxTotalRetries: 10 });

      const config = service.getConfig();
      expect(config.maxTotalRetries).toBe(10);
      expect(config.maxInProgressDurationMs).toBe(1000); // Unchanged
    });
  });

  describe('event handling', () => {
    it('should emit events for stuck items', async () => {
      const events: any[] = [];
      service.onStuckEvent((event) => {
        events.push(event);
      });

      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        status: 'in_progress',
        updated_at: Date.now() - 2000,
      }));

      await service.checkAllWorkItems();

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('work_item_stuck');
    });

    it('should allow removing event handlers', async () => {
      const events: any[] = [];
      const handler = (event: any) => { events.push(event); };

      service.onStuckEvent(handler);
      service.offStuckEvent(handler);

      workItemRepo.addItem(createWorkItem({
        id: 'item-1',
        status: 'in_progress',
        updated_at: Date.now() - 2000,
      }));

      await service.checkAllWorkItems();

      expect(events.length).toBe(0);
    });
  });
});
