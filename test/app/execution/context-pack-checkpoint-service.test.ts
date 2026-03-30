import {
  ContextPackCheckpointService,
  NoopContextPackCheckpointService,
  type IContextPackCheckpointService,
} from '../../../src/app/execution/context-pack-checkpoint-service.js';
import type { IWorkOrderRepository, CreateContextPackParams } from '../../../src/infra/persistence/repository-interface.js';
import type { Goal, WorkItem, Run, ContextSnapshot } from '../../../src/work-order/types/index.js';
import { NoopLogger } from '../../../src/infra/observability/logger.js';

const logger = new NoopLogger();

const makeGoal = (overrides: Partial<Goal> = {}): Goal => ({
  id: 'goal-1',
  created_at: Date.now(),
  updated_at: Date.now(),
  title: 'Test Goal',
  description: 'A test goal',
  success_criteria: [],
  status: 'active',
  priority: 50,
  spent_tokens: 0,
  spent_time_minutes: 0,
  spent_cost_usd: 0,
  ...overrides,
});

const makeWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-1',
  created_at: Date.now(),
  updated_at: Date.now(),
  goal_id: 'goal-1',
  title: 'Test Work Item',
  description: 'A test work item',
  item_type: 'code',
  status: 'done',
  priority: 50,
  dependencies: [],
  blocks: [],
  estimated_effort: 'M',
  retry_count: 0,
  max_retries: 3,
  verification_status: 'passed',
  ...overrides,
});

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-1',
  created_at: Date.now(),
  work_item_id: 'wi-1',
  goal_id: 'goal-1',
  agent_type: 'code',
  run_sequence: 1,
  status: 'success',
  tokens_used: 100,
  cost_usd: 0.01,
  artifacts: [],
  ...overrides,
});

function createMockRepository(): jest.Mocked<Pick<IWorkOrderRepository, 'getWorkItemsByGoal' | 'getRunsByWorkItem' | 'createContextPack'>> {
  return {
    getWorkItemsByGoal: jest.fn().mockReturnValue([]),
    getRunsByWorkItem: jest.fn().mockReturnValue([]),
    createContextPack: jest.fn().mockReturnValue({
      id: 'cp-1',
      created_at: Date.now(),
      goal_id: 'goal-1',
      pack_type: 'daily_checkpoint',
      snapshot_data: {} as ContextSnapshot,
      compressed: false,
      size_bytes: 100,
    }),
  };
}

describe('ContextPackCheckpointService', () => {
  describe('checkpointAfterWorkItem', () => {
    it('writes a daily_checkpoint context pack to the repository', async () => {
      const mockRepo = createMockRepository();
      const goal = makeGoal();
      const doneItem = makeWorkItem({ id: 'wi-1', status: 'done' });
      const readyItem = makeWorkItem({ id: 'wi-2', status: 'ready', item_type: 'test', title: 'Run tests' });
      const blockedItem = makeWorkItem({ id: 'wi-3', status: 'blocked' });
      const successRun = makeRun({ id: 'run-1', status: 'success', agent_type: 'code' });
      const failedRun = makeRun({
        id: 'run-2',
        status: 'failure',
        agent_type: 'code',
        error_message: 'Something broke',
        error_signature: 'sig-abc',
      });

      mockRepo.getWorkItemsByGoal.mockReturnValue([doneItem, readyItem, blockedItem]);
      mockRepo.getRunsByWorkItem.mockImplementation((wiId: string) => {
        if (wiId === 'wi-1') return [successRun, failedRun];
        return [];
      });

      const service = new ContextPackCheckpointService(
        mockRepo as unknown as IWorkOrderRepository,
        logger,
      );

      await service.checkpointAfterWorkItem(goal, doneItem, successRun);

      expect(mockRepo.createContextPack).toHaveBeenCalledTimes(1);
      const params: CreateContextPackParams = mockRepo.createContextPack.mock.calls[0][0];
      expect(params.goal_id).toBe('goal-1');
      expect(params.pack_type).toBe('daily_checkpoint');

      const snapshot = params.snapshot_data;
      expect(snapshot.goal_state.completed_work_items).toContain('wi-1');
      expect(snapshot.goal_state.current_work_items).toContain('wi-2');
      expect(snapshot.goal_state.blocked_work_items).toContain('wi-3');
      expect(snapshot.execution_summary.total_runs).toBe(2);
      expect(snapshot.execution_summary.success_count).toBe(1);
      expect(snapshot.execution_summary.failure_count).toBe(1);
      expect(snapshot.knowledge_base.pitfalls_discovered.length).toBeGreaterThan(0);
      expect(snapshot.knowledge_base.pitfalls_discovered[0]).toContain('Something broke');
      expect(snapshot.knowledge_base.successful_approaches.length).toBe(1);
      expect(snapshot.next_actions.recommended_work_items).toContain('wi-2');
    });

    it('handles goals with no runs gracefully', async () => {
      const mockRepo = createMockRepository();
      const goal = makeGoal();
      const item = makeWorkItem({ status: 'done' });

      mockRepo.getWorkItemsByGoal.mockReturnValue([item]);
      mockRepo.getRunsByWorkItem.mockReturnValue([]);

      const service = new ContextPackCheckpointService(
        mockRepo as unknown as IWorkOrderRepository,
        logger,
      );

      await service.checkpointAfterWorkItem(goal, item, undefined);

      expect(mockRepo.createContextPack).toHaveBeenCalledTimes(1);
      const params = mockRepo.createContextPack.mock.calls[0][0];
      expect(params.snapshot_data.execution_summary.total_runs).toBe(0);
    });
  });

  describe('checkpointOnError', () => {
    it('writes an error_recovery context pack to the repository', async () => {
      const mockRepo = createMockRepository();
      const goal = makeGoal();
      const item = makeWorkItem({ id: 'wi-err', status: 'failed', title: 'Broken task' });
      const run = makeRun({
        id: 'run-err',
        status: 'failure',
        error_message: 'Timeout exceeded',
        error_signature: 'sig-timeout',
      });

      const service = new ContextPackCheckpointService(
        mockRepo as unknown as IWorkOrderRepository,
        logger,
      );

      await service.checkpointOnError(goal, item, run, 'EXECUTION_TIMEOUT');

      expect(mockRepo.createContextPack).toHaveBeenCalledTimes(1);
      const params: CreateContextPackParams = mockRepo.createContextPack.mock.calls[0][0];
      expect(params.goal_id).toBe('goal-1');
      expect(params.pack_type).toBe('error_recovery');

      const snapshot = params.snapshot_data;
      expect(snapshot.execution_summary.failure_count).toBe(1);
      expect(snapshot.knowledge_base.pitfalls_discovered[0]).toContain('EXECUTION_TIMEOUT');
      expect(snapshot.knowledge_base.pitfalls_discovered[0]).toContain('Timeout exceeded');
      expect(snapshot.execution_summary.most_common_errors).toEqual([
        { signature: 'sig-timeout', count: 1 },
      ]);
    });

    it('handles run without error_signature gracefully', async () => {
      const mockRepo = createMockRepository();
      const goal = makeGoal();
      const item = makeWorkItem();
      const run = makeRun({ status: 'failure', error_message: 'generic error' });

      const service = new ContextPackCheckpointService(
        mockRepo as unknown as IWorkOrderRepository,
        logger,
      );

      await service.checkpointOnError(goal, item, run, 'GENERIC');

      const params = mockRepo.createContextPack.mock.calls[0][0];
      expect(params.snapshot_data.execution_summary.most_common_errors).toEqual([]);
    });
  });

  describe('knowledge_base 50-entry cap', () => {
    it('caps total knowledge_base entries at 50', async () => {
      const mockRepo = createMockRepository();
      const goal = makeGoal();

      // Create 30 done work items -> 30 successful_approaches
      const doneItems = Array.from({ length: 30 }, (_, i) =>
        makeWorkItem({ id: `wi-done-${i}`, status: 'done', title: `Done task ${i}` }),
      );
      // Create items with many failed runs
      const failedRuns: Run[] = Array.from({ length: 30 }, (_, i) =>
        makeRun({
          id: `run-fail-${i}`,
          work_item_id: `wi-done-${i % 30}`,
          status: 'failure',
          error_message: `Error ${i}`,
          agent_type: `agent-${i}`,
        }),
      );
      // Create 30 success runs with unique agent types -> 30 learned_patterns (before dedup)
      const successRuns: Run[] = Array.from({ length: 30 }, (_, i) =>
        makeRun({
          id: `run-ok-${i}`,
          work_item_id: `wi-done-${i}`,
          status: 'success',
          agent_type: `unique-agent-${i}`,
        }),
      );

      const allRuns = [...failedRuns, ...successRuns];

      mockRepo.getWorkItemsByGoal.mockReturnValue(doneItems);
      mockRepo.getRunsByWorkItem.mockImplementation((wiId: string) => {
        return allRuns.filter((r) => r.work_item_id === wiId);
      });

      const service = new ContextPackCheckpointService(
        mockRepo as unknown as IWorkOrderRepository,
        logger,
      );

      await service.checkpointAfterWorkItem(goal, doneItems[0], successRuns[0]);

      const params = mockRepo.createContextPack.mock.calls[0][0];
      const kb = params.snapshot_data.knowledge_base;
      const totalEntries =
        kb.pitfalls_discovered.length +
        kb.learned_patterns.length +
        kb.successful_approaches.length;

      expect(totalEntries).toBeLessThanOrEqual(50);
      // Pitfalls should get priority (up to half the budget)
      expect(kb.pitfalls_discovered.length).toBeGreaterThan(0);
      expect(kb.pitfalls_discovered.length).toBeLessThanOrEqual(25);
    });
  });

  describe('NoopContextPackCheckpointService', () => {
    it('does nothing on checkpointAfterWorkItem', async () => {
      const noop: IContextPackCheckpointService = new NoopContextPackCheckpointService();
      // Should not throw
      await noop.checkpointAfterWorkItem(
        makeGoal(),
        makeWorkItem(),
        makeRun(),
      );
    });

    it('does nothing on checkpointOnError', async () => {
      const noop: IContextPackCheckpointService = new NoopContextPackCheckpointService();
      // Should not throw
      await noop.checkpointOnError(
        makeGoal(),
        makeWorkItem(),
        makeRun(),
        'TEST_ERROR',
      );
    });
  });
});
