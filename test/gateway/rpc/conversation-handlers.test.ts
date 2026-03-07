import { RpcHandler } from '../../../src/gateway/rpc/rpc-handler.js';
import { Session } from '../../../src/gateway/connection/session.js';
import { registerConversationHandlers } from '../../../src/gateway/rpc/handlers/conversation-handlers.js';

function createSession(permissions: Array<'read' | 'write' | 'admin'>): Session {
  return new Session({
    id: 'sess-conv-rpc-1',
    publicKey: 'pk-conv',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

function createSessionWithChannel(
  permissions: Array<'read' | 'write' | 'admin'>,
  channelType: string,
  channelSessionId: string
): Session {
  return new Session({
    id: 'sess-conv-rpc-1',
    publicKey: 'pk-conv',
    permissions,
    connectedAt: Date.now(),
    lastActivityAt: Date.now(),
    metadata: {
      channelType,
      channelSessionId,
    },
  });
}

describe('conversation handlers', () => {
  it('emits conversation.new event on successful session creation', async () => {
    const rpc = new RpcHandler();
    const eventBus = { emit: jest.fn() };
    const ipcBridge = {
      openSession: jest.fn(async () => ({
        sessionId: 'ses-new-1',
        personaId: 'pony-default',
        state: 'chatting',
        lifecycleState: 'active',
      })),
      listSessions: jest.fn(async () => ({ sessions: [] })),
      sendSessionMessage: jest.fn(),
      getSessionHistory: jest.fn(async () => ({ turns: [] })),
      endSession: jest.fn(async () => ({ success: true })),
      archiveSession: jest.fn(async () => ({ success: true })),
      resumeSession: jest.fn(async () => ({ success: true })),
      getSessionStatus: jest.fn(async () => ({ exists: true })),
    };

    registerConversationHandlers(rpc, eventBus as any, ipcBridge as any);

    const result = await rpc.handle('conversation.new', {}, createSession(['write'])) as {
      sessionId: string;
      personaId: string;
      state: string;
      lifecycleState: string;
    };

    expect(result.sessionId).toBe('ses-new-1');
    expect(ipcBridge.openSession).toHaveBeenCalledTimes(1);
  });

  it('emits message start and success events for non-streaming conversation.message', async () => {
    const rpc = new RpcHandler();
    const eventBus = { emit: jest.fn() };
    const ipcBridge = {
      openSession: jest.fn(),
      listSessions: jest.fn(async () => ({ sessions: [] })),
      sendSessionMessage: jest.fn(async () => ({
        sessionId: 'ses-1',
        response: 'done',
        state: 'chatting',
        decision: 'goal_created',
        decisionReason: 'actionable',
        taskInfo: {
          goalId: 'goal-1',
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

    registerConversationHandlers(rpc, eventBus as any, ipcBridge as any);

    const result = await rpc.handle(
      'conversation.message',
      { sessionId: 'ses-1', message: 'build this' },
      createSession(['write'])
    ) as { sessionId: string; decision?: string };

    expect(result.sessionId).toBe('ses-1');
    expect(result.decision).toBe('goal_created');
    expect(ipcBridge.sendSessionMessage).toHaveBeenCalledTimes(1);
  });

  it('emits message.failed event when conversation.message processing fails', async () => {
    const rpc = new RpcHandler();
    const eventBus = { emit: jest.fn() };
    const ipcBridge = {
      openSession: jest.fn(),
      listSessions: jest.fn(async () => ({ sessions: [] })),
      sendSessionMessage: jest.fn(async () => {
        throw new Error('simulated failure');
      }),
      getSessionHistory: jest.fn(async () => ({ turns: [] })),
      endSession: jest.fn(async () => ({ success: true })),
      archiveSession: jest.fn(async () => ({ success: true })),
      resumeSession: jest.fn(async () => ({ success: true })),
      getSessionStatus: jest.fn(async () => ({ exists: true })),
    };

    registerConversationHandlers(rpc, eventBus as any, ipcBridge as any);

    await expect(
      rpc.handle(
        'conversation.message',
        { sessionId: 'ses-err', message: 'trigger failure' },
        createSession(['write'])
      )
    ).rejects.toMatchObject({ message: expect.stringContaining('Failed to process message') });

    expect(eventBus.emit).toHaveBeenCalledWith(
      'conversation.message.failed',
      expect.objectContaining({
        sessionId: 'ses-err',
        error: 'simulated failure',
      })
    );
  });

  it('forwards session channel envelope to scheduler bridge', async () => {
    const rpc = new RpcHandler();
    const eventBus = { emit: jest.fn() };
    const ipcBridge = {
      openSession: jest.fn(async () => ({
        sessionId: 'ses-new-1',
        personaId: 'pony-default',
        state: 'chatting',
        lifecycleState: 'active',
      })),
      listSessions: jest.fn(async () => ({ sessions: [] })),
      sendSessionMessage: jest.fn(async () => ({
        sessionId: 'ses-1',
        response: 'done',
        state: 'chatting',
      })),
      getSessionHistory: jest.fn(async () => ({ turns: [] })),
      endSession: jest.fn(async () => ({ success: true })),
      archiveSession: jest.fn(async () => ({ success: true })),
      resumeSession: jest.fn(async () => ({ success: true })),
      getSessionStatus: jest.fn(async () => ({ exists: true })),
    };

    registerConversationHandlers(rpc, eventBus as any, ipcBridge as any);

    const session = createSessionWithChannel(['write'], 'discord', 'discord-thread-1');

    await rpc.handle('conversation.new', {}, session);
    await rpc.handle('conversation.message', { message: 'ping', sessionId: 'ses-1' }, session);

    expect(ipcBridge.openSession).toHaveBeenCalledWith(expect.objectContaining({
      channelType: 'discord',
      channelSessionId: 'discord-thread-1',
    }));
    expect(ipcBridge.sendSessionMessage).toHaveBeenCalledWith(expect.objectContaining({
      channelType: 'discord',
      channelSessionId: 'discord-thread-1',
    }));
  });
});
