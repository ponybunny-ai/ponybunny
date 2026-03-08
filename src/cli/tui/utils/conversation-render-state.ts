export type ConversationRenderState =
  | 'no-session'
  | 'loading'
  | 'error'
  | 'empty'
  | 'stream';

export function resolveConversationRenderState(input: {
  activeSessionId: string | null;
  mergedTurnCount: number;
  conversationLoading: boolean;
  conversationError: string | null;
}): ConversationRenderState {
  if (!input.activeSessionId) {
    return 'no-session';
  }

  if (input.mergedTurnCount > 0) {
    return 'stream';
  }

  if (input.conversationLoading) {
    return 'loading';
  }

  if (input.conversationError) {
    return 'error';
  }

  return 'empty';
}
