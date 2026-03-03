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

describe('conversation handlers', () => {
  it('emits conversation.new event on successful session creation', async () => {
    const rpc = new RpcHandler();
    const eventBus = { emit: jest.fn() };
    const sessionManager = {
      createSession: jest.fn(() => ({
        id: 'ses-new-1',
        personaId: 'pony-default',
        state: 'chatting',
        lifecycleState: 'active',
      })),
      listSessions: jest.fn(() => []),
      processMessage: jest.fn(),
      processMessageWithStream: jest.fn(),
      getHistory: jest.fn(() => []),
      endSession: jest.fn(() => true),
      archiveSession: jest.fn(() => ({ success: true })),
      resumeSession: jest.fn(() => true),
      getSession: jest.fn(),
    };

    registerConversationHandlers(rpc, sessionManager as any, eventBus as any);

    const result = await rpc.handle('conversation.new', {}, createSession(['write'])) as {
      sessionId: string;
      personaId: string;
      state: string;
      lifecycleState: string;
    };

    expect(result.sessionId).toBe('ses-new-1');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'conversation.new',
      expect.objectContaining({
        sessionId: 'ses-new-1',
        personaId: 'pony-default',
        state: 'chatting',
        lifecycleState: 'active',
      })
    );
  });

  it('emits message start and success events for non-streaming conversation.message', async () => {
    const rpc = new RpcHandler();
    const eventBus = { emit: jest.fn() };
    const sessionManager = {
      createSession: jest.fn(),
      listSessions: jest.fn(() => []),
      processMessage: jest.fn(async () => ({
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
      processMessageWithStream: jest.fn(),
      getHistory: jest.fn(() => []),
      endSession: jest.fn(() => true),
      archiveSession: jest.fn(() => ({ success: true })),
      resumeSession: jest.fn(() => true),
      getSession: jest.fn(),
    };

    registerConversationHandlers(rpc, sessionManager as any, eventBus as any);

    const result = await rpc.handle(
      'conversation.message',
      { sessionId: 'ses-1', message: 'build this' },
      createSession(['write'])
    ) as { sessionId: string; decision?: string };

    expect(result.sessionId).toBe('ses-1');
    expect(result.decision).toBe('goal_created');
    expect(eventBus.emit).toHaveBeenCalledWith(
      'conversation.message.started',
      expect.objectContaining({ sessionId: 'ses-1' })
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      'conversation.message.succeeded',
      expect.objectContaining({
        sessionId: 'ses-1',
        decision: 'goal_created',
        hasTask: true,
        stream: false,
      })
    );
  });

  it('emits message.failed event when conversation.message processing fails', async () => {
    const rpc = new RpcHandler();
    const eventBus = { emit: jest.fn() };
    const sessionManager = {
      createSession: jest.fn(),
      listSessions: jest.fn(() => []),
      processMessage: jest.fn(async () => {
        throw new Error('simulated failure');
      }),
      processMessageWithStream: jest.fn(),
      getHistory: jest.fn(() => []),
      endSession: jest.fn(() => true),
      archiveSession: jest.fn(() => ({ success: true })),
      resumeSession: jest.fn(() => true),
      getSession: jest.fn(),
    };

    registerConversationHandlers(rpc, sessionManager as any, eventBus as any);

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
});
