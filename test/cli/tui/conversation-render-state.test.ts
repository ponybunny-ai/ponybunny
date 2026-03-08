import { resolveConversationRenderState } from '../../../src/cli/tui/utils/conversation-render-state.js';

describe('resolveConversationRenderState', () => {
  it('returns stream when optimistic or persisted turns exist even during loading', () => {
    const state = resolveConversationRenderState({
      activeSessionId: 'ses-1',
      mergedTurnCount: 1,
      conversationLoading: true,
      conversationError: null,
    });

    expect(state).toBe('stream');
  });

  it('returns loading only when there are no turns yet', () => {
    const state = resolveConversationRenderState({
      activeSessionId: 'ses-1',
      mergedTurnCount: 0,
      conversationLoading: true,
      conversationError: null,
    });

    expect(state).toBe('loading');
  });

  it('returns empty when session exists and there is no data or loading/error', () => {
    const state = resolveConversationRenderState({
      activeSessionId: 'ses-1',
      mergedTurnCount: 0,
      conversationLoading: false,
      conversationError: null,
    });

    expect(state).toBe('empty');
  });

  it('returns no-session when no active session', () => {
    const state = resolveConversationRenderState({
      activeSessionId: null,
      mergedTurnCount: 2,
      conversationLoading: false,
      conversationError: null,
    });

    expect(state).toBe('no-session');
  });
});
