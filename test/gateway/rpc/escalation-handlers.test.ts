import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { EventBus } from '../../../src/gateway/events/event-bus.js';
import {
  registerEscalationHandlers,
  type IRemoteSchedulerClient,
} from '../../../src/gateway/rpc/handlers/escalation-handlers.js';

function createSession(): Session {
  return new Session({
    id: 'sess-esc-1',
    publicKey: 'pk-escalation',
    permissions: ['read', 'write', 'admin'],
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

describe('escalation handlers approval resume flow', () => {
  it('re-queues existing work item and re-submits goal when escalation response requests retry', async () => {
    const now = Date.now();
    const rpc = new RpcHandler();
    const session = createSession();

    const repository = {
      getEscalation: jest.fn(() => ({
        id: 'esc-1',
        work_item_id: 'wi-1',
        goal_id: 'goal-1',
        status: 'open',
      })),
      resolveEscalation: jest.fn(),
      listEscalations: jest.fn(() => []),
      getWorkItem: jest.fn(() => ({
        id: 'wi-1',
        created_at: now,
        updated_at: now,
        goal_id: 'goal-1',
        title: 'Needs approval',
        description: 'run dangerous command',
        item_type: 'analysis',
        status: 'failed',
        priority: 50,
        dependencies: [],
        blocks: [],
        estimated_effort: 'S',
        retry_count: 0,
        max_retries: 1,
        verification_status: 'not_started',
        context: {
          approval_required: true,
          approval_actions: ['execute_command'],
        },
      })),
      getGoal: jest.fn(() => ({
        id: 'goal-1',
        created_at: now,
        updated_at: now,
        title: 'goal',
        description: 'goal',
        success_criteria: [],
        status: 'failed',
        priority: 50,
        spent_tokens: 0,
        spent_time_minutes: 0,
        spent_cost_usd: 0,
      })),
      createWorkItem: jest.fn(() => ({ id: 'wi-2' })),
      updateWorkItemStatus: jest.fn(),
      updateGoalStatus: jest.fn(),
    } as any;

    const remoteScheduler = {
      isSchedulerDaemonConnected: jest.fn(() => true),
      submitGoal: jest.fn(async () => {}),
    } as IRemoteSchedulerClient;

    registerEscalationHandlers(rpc, repository as any, new EventBus(), () => null, remoteScheduler);

    const result = await rpc.handle(
      'escalation.respond',
      {
        escalationId: 'esc-1',
        action: 'retry',
        data: {
          selected_skill_override: 'postgres-query',
          selected_mcp_tool_override: 'mcp__github__search_repositories',
        },
      },
      session
    );

    expect(result).toEqual({ success: true });
    expect(repository.resolveEscalation).toHaveBeenCalledWith(
      'esc-1',
      'retry',
      {
        selected_skill_override: 'postgres-query',
        selected_mcp_tool_override: 'mcp__github__search_repositories',
      },
      'pk-escalation'
    );
    expect(repository.updateWorkItemStatus).toHaveBeenCalledWith('wi-1', 'ready');
    expect(repository.updateGoalStatus).toHaveBeenCalledWith('goal-1', 'queued');
    expect(remoteScheduler.submitGoal).toHaveBeenCalledWith('goal-1');
  });
});
