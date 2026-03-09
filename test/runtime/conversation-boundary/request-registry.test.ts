import {
  ConversationRequestRegistry,
  type ConversationRequest,
  type ConversationResult,
} from '../../../src/runtime/conversation-boundary/index.js';

describe('ConversationRequestRegistry', () => {
  function createRequest(overrides: Partial<ConversationRequest> = {}): ConversationRequest {
    return {
      conversationRequestId: 'conv-req-1',
      sessionId: 'ses-1',
      personaId: 'pony-default',
      userProfileId: 'user-1',
      agentId: 'planner',
      message: 'hello',
      attachments: [
        {
          type: 'file',
          mimeType: 'text/plain',
          filename: 'spec.txt',
          url: 'file:///tmp/spec.txt',
        },
      ],
      ...overrides,
    };
  }

  function createResult(request: ConversationRequest, overrides: Partial<ConversationResult> = {}): ConversationResult {
    return {
      conversationRequestId: request.conversationRequestId,
      sessionId: request.sessionId ?? 'ses-1',
      response: 'hello back',
      state: 'chatting',
      ...overrides,
    };
  }

  it('registers one pending promise per conversationRequestId and preserves request identity context', () => {
    const registry = new ConversationRequestRegistry();
    const request = createRequest();

    const registration = registry.register(request);

    expect(registration.kind).toBe('registered');
    expect(registry.inspect()).toEqual({
      pending: [
        expect.objectContaining({
          conversationRequestId: request.conversationRequestId,
          sessionId: request.sessionId,
          personaId: request.personaId,
          userProfileId: request.userProfileId,
          agentId: request.agentId,
          state: 'pending',
          registeredAt: expect.any(Number),
          messageDigest: expect.any(String),
          attachmentIdentity: [
            expect.objectContaining({
              type: 'file',
              mimeType: 'text/plain',
              filename: 'spec.txt',
              url: 'file:///tmp/spec.txt',
              hasBase64: false,
            }),
          ],
        }),
      ],
      recent: [],
    });
  });

  it('returns the same promise for matching duplicate registration and resolves only once', async () => {
    const registry = new ConversationRequestRegistry();
    const request = createRequest();
    const first = registry.register(request);
    const duplicate = registry.register(createRequest());

    expect(first.kind).toBe('registered');
    expect(duplicate.kind).toBe('duplicate');
    if (first.kind !== 'registered' || duplicate.kind !== 'duplicate') {
      throw new Error('Expected duplicate registration flow');
    }

    expect(duplicate.promise).toBe(first.promise);

    const result = createResult(request);
    expect(first.owner.resolveSuccess(result)).toBe(true);
    expect(first.owner.resolveInvalid(new Error('late invalid completion'))).toBe(false);

    await expect(first.promise).resolves.toEqual(result);
    expect(registry.inspect()).toEqual({
      pending: [],
      recent: [
        expect.objectContaining({
          conversationRequestId: request.conversationRequestId,
          state: 'resolved',
          terminal: expect.objectContaining({
            outcome: 'success',
            resultSessionId: request.sessionId,
          }),
        }),
      ],
    });
  });

  it('rejects conflicting identity reuse for the same conversationRequestId', () => {
    const registry = new ConversationRequestRegistry();
    const request = createRequest();

    registry.register(request);
    const conflict = registry.register(createRequest({
      message: 'different',
    }));

    expect(conflict.kind).toBe('conflict');
    expect(conflict.entry).toEqual(expect.objectContaining({
      conversationRequestId: request.conversationRequestId,
      sessionId: request.sessionId,
      personaId: request.personaId,
      userProfileId: request.userProfileId,
      agentId: request.agentId,
    }));
  });
});
