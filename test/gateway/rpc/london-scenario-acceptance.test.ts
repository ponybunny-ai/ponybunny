import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { EventBus } from '../../../src/gateway/events/event-bus.js';
import { registerConversationHandlers } from '../../../src/gateway/rpc/handlers/conversation-handlers.js';
import { registerGoalHandlers, type IRemoteSchedulerClient } from '../../../src/gateway/rpc/handlers/goal-handlers.js';
import type { IWorkOrderRepository } from '../../../src/infra/persistence/repository-interface.js';
import type { IPCBridge } from '../../../src/gateway/integration/ipc-bridge.js';

function createSession(channelType: 'discord' | 'tui' = 'discord'): Session {
  return new Session({
    id: 'gateway-session-london',
    publicKey: 'pk-london',
    permissions: ['read', 'write', 'admin'],
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    metadata: {
      channelType,
      channelSessionId: `${channelType}-thread-1`,
    },
  });
}

describe('London scenario acceptance', () => {
  it('runs through session-first messaging and scheduler-side goal materialization', async () => {
    const rpc = new RpcHandler();
    const eventBus = new EventBus();
    const session = createSession('discord');
    const now = Date.now();

    const ipcBridge = {
      openSession: jest.fn(async () => ({
        sessionId: 'ses-london-1',
        personaId: 'pony-default',
        state: 'chatting',
        lifecycleState: 'active',
      })),
      listSessions: jest.fn(async () => ({ sessions: [] })),
      sendSessionMessage: jest.fn(async () => ({
        sessionId: 'ses-london-1',
        response: 'I will create and run the weather script now.',
        state: 'chatting',
        decision: 'goal_created',
        decisionReason: 'actionable task request',
        taskInfo: {
          goalId: 'goal-london-1',
          status: 'queued',
          progress: 0,
        },
      })),
      getSessionHistory: jest.fn(async () => ({ turns: [] })),
      endSession: jest.fn(async () => ({ success: true })),
      archiveSession: jest.fn(async () => ({ success: true })),
      resumeSession: jest.fn(async () => ({ success: true })),
      getSessionStatus: jest.fn(async () => ({ exists: true })),
    };

    registerConversationHandlers(rpc, eventBus, ipcBridge as unknown as IPCBridge);

    const repository = {
      createGoal: jest.fn(),
      createWorkItem: jest.fn(),
      getGoal: jest.fn(),
      updateGoalStatus: jest.fn(),
      listGoals: jest.fn(() => []),
    } as unknown as IWorkOrderRepository;

    const remoteScheduler = {
      isSchedulerDaemonConnected: jest.fn(() => true),
      materializeGoal: jest.fn(async () => ({
        goal: {
          id: 'goal-london-1',
          created_at: now,
          updated_at: now,
          title: 'London rain checker script',
          description: 'Create, save, and run a shell script to check London weather.',
          success_criteria: [],
          status: 'queued',
          priority: 50,
          spent_tokens: 0,
          spent_time_minutes: 0,
          spent_cost_usd: 0,
        },
        initialWorkItemId: 'wi-london-1',
      })),
      submitGoal: jest.fn(async () => {}),
      cancelGoal: jest.fn(async () => {}),
    } as IRemoteSchedulerClient;

    registerGoalHandlers(rpc, repository, eventBus, () => null, undefined, remoteScheduler);

    const londonPrompt = '我想知道后天London是否下雨。写一个shell脚本来实现这个功能，并且将脚本保存到当前用户的home目录下，运行后给我最终的结果。';

    await rpc.handle('conversation.new', {}, session);
    const conversationResult = await rpc.handle(
      'conversation.message',
      {
        sessionId: 'ses-london-1',
        message: londonPrompt,
      },
      session
    ) as { decision: string; taskInfo?: { goalId?: string } };

    expect(conversationResult.decision).toBe('goal_created');
    expect(ipcBridge.sendSessionMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ses-london-1',
      message: londonPrompt,
      channelType: 'discord',
      channelSessionId: 'discord-thread-1',
    }));

    const createdGoal = await rpc.handle(
      'goal.submit',
      {
        title: 'London rain checker script',
        description: 'Create and run shell script in user home directory.',
        success_criteria: [],
        context: {
          createdViaConversation: true,
          sessionId: 'ses-london-1',
          turnId: 'turn-london-1',
          channelType: 'discord',
          channelSessionId: 'discord-thread-1',
        },
      },
      session
    ) as { id: string };

    expect(createdGoal.id).toBe('goal-london-1');
    expect(remoteScheduler.materializeGoal).toHaveBeenCalledWith(expect.objectContaining({
      autoSubmitGoal: true,
      goalSpec: expect.objectContaining({
        title: 'London rain checker script',
      }),
      initialWorkItemSpec: expect.objectContaining({
        item_type: 'analysis',
      }),
    }));
    expect(remoteScheduler.submitGoal).not.toHaveBeenCalled();
  });
});
