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

  it('returns standardized run result DTO from workitem.runs', async () => {
    const rpc = new RpcHandler();
    const session = createSession();
    const goal = createGoal('goal-run-dto');
    const workItem = createWorkItem('wi-run-dto', goal.id, 'done');

    const repository = {
      listGoals: jest.fn(() => [goal]),
      getWorkItemsByGoal: jest.fn(() => [workItem]),
      getGoal: jest.fn(() => goal),
      getWorkItem: jest.fn(() => workItem),
      getRunsByWorkItem: jest.fn(() => [{
        id: 'run-1',
        work_item_id: workItem.id,
        goal_id: goal.id,
        status: 'success',
        created_at: Date.now() - 1000,
        completed_at: Date.now(),
        tokens_used: 123,
        time_seconds: 2,
        cost_usd: 0.0042,
        execution_log: 'Implemented change and validated tests.',
        error_message: undefined,
        artifacts: ['artifact-1'],
      }]),
      getReadyWorkItems: jest.fn(() => []),
      updateWorkItemStatus: jest.fn(),
      incrementWorkItemRetry: jest.fn(),
      updateWorkItemStatusIfDependenciesMet: jest.fn(),
      updateGoalStatus: jest.fn(),
    } as unknown as IWorkOrderRepository;

    registerWorkItemHandlers(rpc, repository);

    const result = await rpc.handle('workitem.runs', { workItemId: workItem.id }, session) as {
      runs: Array<{
        ids: { runId: string; workItemId: string; goalId: string };
        output: { summary: string };
        artifacts: { count: number };
        usage: { tokensUsed: number };
      }>;
    };

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].ids).toEqual({
      runId: 'run-1',
      workItemId: workItem.id,
      goalId: goal.id,
    });
    expect(result.runs[0].output.summary).toContain('Implemented change');
    expect(result.runs[0].artifacts.count).toBe(1);
    expect(result.runs[0].usage.tokensUsed).toBe(123);
  });
});
