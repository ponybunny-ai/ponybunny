import { ConversationWorker } from '../../src/runtime/workers/conversation-worker.js';
import type { IConversationResponse } from '../../src/app/conversation/session-manager.js';

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

  it('suppresses exact duplicate in-flight requests by conversationRequestId and exposes inspection state', async () => {
    let resolveResult: ((value: IConversationResponse) => void) | undefined;

    const orchestrator = {
      processMessage: jest.fn(() => new Promise<IConversationResponse>((resolve) => {
        resolveResult = resolve;
      })),
    };

    const worker = new ConversationWorker(orchestrator);
    const request = {
      conversationRequestId: 'conv-req-duplicate',
      sessionId: 'ses-123',
      personaId: 'pony-default',
      userProfileId: 'user-1',
      agentId: 'planner',
      message: 'hello',
      attachments: [],
    };

    const first = worker.process(request);
    const second = worker.process({ ...request });

    expect(orchestrator.processMessage).toHaveBeenCalledTimes(1);

    resolveResult?.({
      sessionId: 'ses-123',
      response: 'hello back',
      state: 'chatting',
    });

    await expect(first).resolves.toEqual({
      conversationRequestId: 'conv-req-duplicate',
      sessionId: 'ses-123',
      response: 'hello back',
      state: 'chatting',
      decision: undefined,
      decisionReason: undefined,
      taskInfo: undefined,
    });
    await expect(second).resolves.toEqual({
      conversationRequestId: 'conv-req-duplicate',
      sessionId: 'ses-123',
      response: 'hello back',
      state: 'chatting',
      decision: undefined,
      decisionReason: undefined,
      taskInfo: undefined,
    });

    expect(worker.inspect()).toEqual({
      summary: {
        totalRequests: 1,
        inFlightCount: 0,
        recentCount: 1,
        successCount: 1,
        failureCount: 0,
        invalidCount: 0,
        duplicateSuppressedCount: 1,
      },
      inFlight: [],
      recent: [
        expect.objectContaining({
          conversationRequestId: 'conv-req-duplicate',
          requestedSessionId: 'ses-123',
          resultSessionId: 'ses-123',
          outcome: 'success',
          resultMatchedRequestId: true,
          sessionIdMatched: true,
          duplicateSuppressed: true,
          duplicateDispatchCount: 1,
          messageLength: 5,
          failureCode: undefined,
        }),
      ],
    });
  });

  it('marks invalid worker results in inspection and rejects safely', async () => {
    const orchestrator = {
      processMessage: jest.fn(async () => ({
        sessionId: '',
        response: 'hello back',
        state: 'chatting' as const,
      })),
    };

    const worker = new ConversationWorker(orchestrator);

    await expect(worker.process({
      conversationRequestId: 'conv-req-invalid',
      sessionId: 'ses-123',
      message: 'hello',
    })).rejects.toThrow(
      "Conversation request 'conv-req-invalid' returned an invalid sessionId"
    );

    expect(worker.inspect()).toEqual({
      summary: {
        totalRequests: 1,
        inFlightCount: 0,
        recentCount: 1,
        successCount: 0,
        failureCount: 0,
        invalidCount: 1,
        duplicateSuppressedCount: 0,
      },
      inFlight: [],
      recent: [
        expect.objectContaining({
          conversationRequestId: 'conv-req-invalid',
          requestedSessionId: 'ses-123',
          resultSessionId: undefined,
          outcome: 'invalid',
          resultMatchedRequestId: false,
          sessionIdMatched: undefined,
          duplicateSuppressed: false,
          duplicateDispatchCount: 0,
          failureCode: 'CONVERSATION_RESULT_INVALID',
        }),
      ],
    });
  });
});
