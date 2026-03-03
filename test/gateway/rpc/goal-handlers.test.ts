import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { EventBus } from '../../../src/gateway/events/event-bus.js';
import { registerGoalHandlers, type IRemoteSchedulerClient } from '../../../src/gateway/rpc/handlers/goal-handlers.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';

const loadAgentsMock = jest.fn(async () => {});
const getAgentMock = jest.fn();

jest.mock('../../../src/infra/agents/agent-registry.js', () => ({
  getGlobalAgentRegistry: () => ({
    loadAgents: loadAgentsMock,
    getAgent: getAgentMock,
  }),
}));

jest.mock('../../../src/infra/config/runtime-config.js', () => ({
  loadRuntimeConfig: () => ({
    paths: {
      database: '/tmp/pony.db',
      schedulerSocket: '/tmp/pony.sock',
    },
    gateway: {
      host: '127.0.0.1',
      port: 8080,
    },
    scheduler: {
      tickIntervalMs: 1000,
      maxConcurrentGoals: 5,
      agentsEnabled: true,
      deterministicRuntimeEnabled: false,
      planCompilerEnabled: false,
      toolRoutingMode: 'legacy',
    },
    agent: {
      mainAgentId: 'lead',
      personaEnabled: false,
    },
    debug: {
      serverPort: 3001,
      loggingEnabled: false,
      antigravityDebug: false,
    },
  }),
}));

jest.mock('../../../src/infra/agents/agent-workdir.js', () => ({
  ensureAgentWorkdir: () => '/tmp/pony-workdir/lead',
}));

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
    loadAgentsMock.mockClear();
    getAgentMock.mockReset();
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

  it('submits human agent command as agent_tick work item', async () => {
    const now = Date.now();
    const repository = {
      createGoal: jest.fn(() => ({
        id: 'goal-3',
        created_at: now,
        updated_at: now,
        title: 'Agent Command: Lead',
        description: 'summarize pipeline status',
        success_criteria: [],
        status: 'queued',
        priority: 50,
        spent_tokens: 0,
        spent_time_minutes: 0,
        spent_cost_usd: 0,
      })),
      createWorkItem: jest.fn(() => ({ id: 'wi-3' })),
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
      listGoals: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;

    const remoteScheduler = {
      isSchedulerDaemonConnected: jest.fn(() => true),
      submitGoal: jest.fn(async () => {}),
      cancelGoal: jest.fn(async () => {}),
    } as IRemoteSchedulerClient;

    getAgentMock.mockReturnValue({
      id: 'lead',
      definitionHash: 'hash-lead',
      configPath: '/tmp/agents/lead/agent.json',
      config: {
        id: 'lead',
        name: 'Lead',
        enabled: true,
        workdir: './workdir',
        policy: {
          toolAllowlist: ['read_file', 'search_code'],
          toolDenylist: [],
          forbiddenPatterns: [],
          approval: {
            required: true,
            actions: ['execute_command'],
          },
        },
      },
    });

    registerGoalHandlers(rpc, repository, new EventBus(), () => null, undefined, remoteScheduler);

    const result = await rpc.handle(
      'agent.command.submit',
      {
        command: 'summarize pipeline status',
      },
      session
    );

    expect((result as { id: string }).id).toBe('goal-3');
    expect(loadAgentsMock).toHaveBeenCalledTimes(1);
    expect(repository.createWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        goal_id: 'goal-3',
        item_type: 'analysis',
        context: expect.objectContaining({
          kind: 'agent_tick',
          agent_id: 'lead',
          definition_hash: 'hash-lead',
          agent_workdir: '/tmp/pony-workdir/lead',
          tool_allowlist: ['read_file', 'search_code'],
          approval_required: true,
          approval_actions: ['execute_command'],
        }),
      })
    );
    expect(remoteScheduler.submitGoal).toHaveBeenCalledWith('goal-3');
  });

  it('rejects conversation-created goal submit when sessionId/turnId linkage is missing', async () => {
    const repository = {
      createGoal: jest.fn(),
      createWorkItem: jest.fn(),
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
      listGoals: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;

    registerGoalHandlers(rpc, repository, new EventBus(), () => null, undefined, undefined);

    await expect(
      rpc.handle(
        'goal.submit',
        {
          title: 'missing linkage',
          description: 'created via conversation but missing linkage keys',
          success_criteria: [],
          context: {
            createdViaConversation: true,
          },
        },
        session
      )
    ).rejects.toThrow('Conversation goal context requires sessionId');
  });

  it('forwards sessionId filter to repository on goal.list', async () => {
    const repository = {
      listGoals: jest.fn(() => []),
      createGoal: jest.fn(),
      createWorkItem: jest.fn(),
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
    } as unknown as IWorkOrderRepository;

    registerGoalHandlers(rpc, repository, new EventBus(), () => null, undefined, undefined);

    const result = await rpc.handle('goal.list', { sessionId: 'ses-123', limit: 20, offset: 0 }, session);
    expect(result).toEqual({ goals: [], total: 0 });
    expect(repository.listGoals).toHaveBeenCalledWith({
      status: undefined,
      session_id: 'ses-123',
    });
  });
});
