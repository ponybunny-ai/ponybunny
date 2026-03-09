import { ConversationWorker } from '../../src/runtime/workers/conversation-worker.js';

describe('ConversationWorker', () => {
  it('preserves conversationRequestId and passes through current orchestration results', async () => {
    const orchestrator = {
      processMessage: jest.fn(async () => ({
        sessionId: 'ses-123',
        response: 'hello back',
        state: 'chatting' as const,
        decision: 'response_only' as const,
        decisionReason: 'Session responded conversationally without creating a goal.',
        taskInfo: undefined,
      })),
    };

    const worker = new ConversationWorker(orchestrator);
    const result = await worker.process({
      conversationRequestId: 'conv-req-123',
      sessionId: 'ses-123',
      personaId: 'pony-default',
      userProfileId: 'user-1',
      agentId: 'planner',
      message: 'hello',
      attachments: [
        {
          type: 'image',
          mimeType: 'image/png',
          url: 'https://example.com/image.png',
        },
      ],
    });

    expect(orchestrator.processMessage).toHaveBeenCalledWith(
      'hello',
      'ses-123',
      'pony-default',
      'user-1',
      [
        expect.objectContaining({
          type: 'image',
          mimeType: 'image/png',
        }),
      ],
      'planner'
    );

    expect(result).toEqual({
      conversationRequestId: 'conv-req-123',
      sessionId: 'ses-123',
      response: 'hello back',
      state: 'chatting',
      decision: 'response_only',
      decisionReason: 'Session responded conversationally without creating a goal.',
      taskInfo: undefined,
    });
  });
});
