import { resolvePendingConversationState } from '../../../src/cli/tui/utils/conversation-pending-state.js';
import type { SimpleMessage } from '../../../src/cli/tui/store/types.js';

function createSimpleMessage(overrides: Partial<SimpleMessage> = {}): SimpleMessage {
  return {
    id: 'msg-1',
    input: 'how are you?',
    source: 'conversation',
    status: 'processing',
    sessionId: 'ses-1',
    timeline: [],
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('resolvePendingConversationState', () => {
  it('returns the latest unsynced conversation message while waiting for reply', () => {
    const state = resolvePendingConversationState({
      activeSessionId: 'ses-1',
      simpleMessages: [
        createSimpleMessage({ id: 'msg-1', input: 'older question', timestamp: 10 }),
        createSimpleMessage({ id: 'msg-2', input: 'latest question', timestamp: 20 }),
      ],
      conversationTurns: [],
    });

    expect(state).toEqual({
      input: 'latest question',
      status: 'processing',
      statusText: undefined,
      error: undefined,
      timestamp: 20,
      syncState: 'awaiting_reply',
    });
  });

  it('marks completed messages as syncing until the user turn appears in history', () => {
    const state = resolvePendingConversationState({
      activeSessionId: 'ses-1',
      simpleMessages: [
        createSimpleMessage({
          status: 'completed',
          statusText: 'Conversation response ready',
        }),
      ],
      conversationTurns: [],
    });

    expect(state?.syncState).toBe('syncing_history');
  });

  it('drops the pending state once the user turn is persisted in session history', () => {
    const state = resolvePendingConversationState({
      activeSessionId: 'ses-1',
      simpleMessages: [createSimpleMessage()],
      conversationTurns: [
        {
          role: 'user',
          content: 'how are you?',
          timestamp: 1_700_000_000_500,
        },
        {
          role: 'assistant',
          content: 'Doing well.',
          timestamp: 1_700_000_001_000,
        },
      ],
    });

    expect(state).toBeNull();
  });

  it('surfaces failed conversation messages until they are reflected in history', () => {
    const state = resolvePendingConversationState({
      activeSessionId: 'ses-1',
      simpleMessages: [
        createSimpleMessage({
          status: 'failed',
          error: 'Gateway timeout',
        }),
      ],
      conversationTurns: [],
    });

    expect(state).toEqual({
      input: 'how are you?',
      status: 'failed',
      statusText: undefined,
      error: 'Gateway timeout',
      timestamp: 1_700_000_000_000,
      syncState: 'failed',
    });
  });
});
