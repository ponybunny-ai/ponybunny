import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { registerWorkItemHandlers } from '../../../src/gateway/rpc/handlers/workitem-handlers.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { Goal, WorkItem } from '../../../src/work-order/types/index.js';

function createSession(): Session {
  return new Session({
    id: 'sess-workitem-1',
    publicKey: 'pk-workitem',
    permissions: ['read', 'write', 'admin'],
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

function createGoal(id: string): Goal {
  const now = Date.now();
  return {
    id,
    created_at: now,
    updated_at: now,
    title: id,
    description: id,
    success_criteria: [],
    status: 'active',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
  };
}

function createWorkItem(id: string, goalId: string, status: WorkItem['status']): WorkItem {
  const now = Date.now();
  return {
    id,
    created_at: now,
    updated_at: now,
    goal_id: goalId,
    title: id,
    description: id,
    item_type: 'analysis',
    status,
    priority: 1,
    dependencies: [],
    blocks: [],
    estimated_effort: 'S',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
  };
}

describe('workitem handlers', () => {
  it('lists historical work items (not only ready items)', async () => {
    const rpc = new RpcHandler();
    const session = createSession();
    const goalA = createGoal('goal-a');
    const goalB = createGoal('goal-b');

    const byGoal: Record<string, WorkItem[]> = {
      [goalA.id]: [
        createWorkItem('wi-a-ready', goalA.id, 'ready'),
        createWorkItem('wi-a-done', goalA.id, 'done'),
      ],
      [goalB.id]: [
        createWorkItem('wi-b-failed', goalB.id, 'failed'),
      ],
    };

    const repository = {
      listGoals: jest.fn(() => [goalA, goalB]),
      getWorkItemsByGoal: jest.fn((goalId: string) => byGoal[goalId] ?? []),
      getGoal: jest.fn((goalId: string) => [goalA, goalB].find(g => g.id === goalId)),
      getWorkItem: jest.fn(),
      getRunsByWorkItem: jest.fn(() => []),
      getReadyWorkItems: jest.fn(() => []),
      updateWorkItemStatus: jest.fn(),
      incrementWorkItemRetry: jest.fn(),
      updateWorkItemStatusIfDependenciesMet: jest.fn(),
      updateGoalStatus: jest.fn(),
    } as unknown as IWorkOrderRepository;

    registerWorkItemHandlers(rpc, repository);

    const result = await rpc.handle('workitem.list', {}, session) as { workItems: WorkItem[]; total: number };

    expect(result.total).toBe(3);
    expect(result.workItems.map(w => w.id).sort()).toEqual(['wi-a-done', 'wi-a-ready', 'wi-b-failed']);
  });

  it('retries failed work item by requeueing and incrementing retry count', async () => {
    const rpc = new RpcHandler();
    const session = createSession();
    const goal = createGoal('goal-retry');
    const failed = createWorkItem('wi-failed', goal.id, 'failed');
    const queued = { ...failed, status: 'queued' as const, retry_count: 1 };

    const repository = {
      listGoals: jest.fn(() => [goal]),
      getWorkItemsByGoal: jest.fn(() => [failed]),
      getGoal: jest.fn(() => goal),
      getWorkItem: jest
        .fn()
        .mockImplementationOnce(() => failed)
        .mockImplementationOnce(() => queued),
      getRunsByWorkItem: jest.fn(() => []),
      getReadyWorkItems: jest.fn(() => []),
      updateWorkItemStatus: jest.fn(),
      incrementWorkItemRetry: jest.fn(),
      updateWorkItemStatusIfDependenciesMet: jest.fn(),
      updateGoalStatus: jest.fn(),
    } as unknown as IWorkOrderRepository;

    registerWorkItemHandlers(rpc, repository);

    const result = await rpc.handle('workitem.retry', { workItemId: failed.id }, session) as {
      success: boolean;
      workItem: WorkItem;
    };

    expect(result.success).toBe(true);
    expect(result.workItem.status).toBe('queued');
    expect(repository.incrementWorkItemRetry).toHaveBeenCalledWith(failed.id);
    expect(repository.updateWorkItemStatus).toHaveBeenCalledWith(failed.id, 'queued');
    expect(repository.updateWorkItemStatusIfDependenciesMet).toHaveBeenCalledWith(failed.id);
    expect(repository.updateGoalStatus).toHaveBeenCalledWith(goal.id, 'queued');
  });
});
