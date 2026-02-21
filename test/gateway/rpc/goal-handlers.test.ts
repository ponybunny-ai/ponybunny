import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { EventBus } from '../../../src/gateway/events/event-bus.js';
import { registerGoalHandlers, type IRemoteSchedulerClient } from '../../../src/gateway/rpc/handlers/goal-handlers.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';

function createSession(): Session {
  return new Session({
    id: 'sess-1',
    publicKey: 'pk-test',
    permissions: ['read', 'write', 'admin'],
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

describe('goal handlers remote scheduler forwarding', () => {
  let rpc: RpcHandler;
  let session: Session;

  beforeEach(() => {
    rpc = new RpcHandler();
    session = createSession();
  });

  it('forwards goal.submit to remote scheduler when local scheduler is unavailable', async () => {
    const now = Date.now();
    const repository = {
      createGoal: jest.fn(() => ({
        id: 'goal-1',
        created_at: now,
        updated_at: now,
        title: 'test title',
        description: 'test description',
        success_criteria: [],
        status: 'queued',
        priority: 50,
        spent_tokens: 0,
        spent_time_minutes: 0,
        spent_cost_usd: 0,
      })),
      createWorkItem: jest.fn(() => ({ id: 'wi-1' })),
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
      listGoals: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;

    const remoteScheduler = {
      isSchedulerDaemonConnected: jest.fn(() => true),
      submitGoal: jest.fn(async () => {}),
      cancelGoal: jest.fn(async () => {}),
    } as IRemoteSchedulerClient;

    registerGoalHandlers(rpc, repository, new EventBus(), () => null, undefined, remoteScheduler);

    const result = await rpc.handle(
      'goal.submit',
      {
        title: 'test title',
        description: 'test description',
        success_criteria: [],
      },
      session
    );

    expect((result as { id: string }).id).toBe('goal-1');
    expect(repository.createWorkItem).toHaveBeenCalledWith({
      goal_id: 'goal-1',
      title: 'test title',
      description: 'test description',
      item_type: 'analysis',
      priority: 50,
      dependencies: [],
    });
    expect(remoteScheduler.submitGoal).toHaveBeenCalledWith('goal-1');
  });

  it('forwards goal.cancel to remote scheduler when local scheduler is unavailable', async () => {
    const now = Date.now();
    const repository = {
      createGoal: jest.fn(),
      createWorkItem: jest.fn(() => ({ id: 'wi-2' })),
      getGoal: jest.fn(() => ({
        id: 'goal-2',
        created_at: now,
        updated_at: now,
        title: 'cancel me',
        description: 'cancel me',
        success_criteria: [],
        status: 'queued',
        priority: 50,
        spent_tokens: 0,
        spent_time_minutes: 0,
        spent_cost_usd: 0,
      })),
      updateGoalStatus: jest.fn(),
      listGoals: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;

    const remoteScheduler = {
      isSchedulerDaemonConnected: jest.fn(() => true),
      submitGoal: jest.fn(async () => {}),
      cancelGoal: jest.fn(async () => {}),
    } as IRemoteSchedulerClient;

    registerGoalHandlers(rpc, repository, new EventBus(), () => null, undefined, remoteScheduler);

    const result = await rpc.handle(
      'goal.cancel',
      {
        goalId: 'goal-2',
        reason: 'user requested',
      },
      session
    );

    expect(result).toEqual({ success: true });
    expect(repository.updateGoalStatus).toHaveBeenCalledWith('goal-2', 'cancelled');
    expect(remoteScheduler.cancelGoal).toHaveBeenCalledWith('goal-2', 'user requested');
  });
});
