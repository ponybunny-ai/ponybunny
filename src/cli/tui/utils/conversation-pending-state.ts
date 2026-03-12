import type { SimpleMessage } from '../store/types.js';

export type ConversationTurn = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
};

export type PendingConversationSyncState =
  | 'awaiting_reply'
  | 'syncing_history'
  | 'failed';

export type PendingConversationState = {
  input: string;
  status: SimpleMessage['status'];
  statusText?: string;
  error?: string;
  timestamp: number;
  syncState: PendingConversationSyncState;
};

const MESSAGE_MATCH_WINDOW_MS = 30_000;

function hasPersistedUserTurn(
  message: Pick<SimpleMessage, 'input' | 'timestamp'>,
  turns: ConversationTurn[]
): boolean {
  return turns.some((turn) =>
    turn.role === 'user' &&
    turn.content === message.input &&
    Math.abs(turn.timestamp - message.timestamp) <= MESSAGE_MATCH_WINDOW_MS
  );
}

export function resolvePendingConversationState(input: {
  activeSessionId: string | null;
  simpleMessages: SimpleMessage[];
  conversationTurns: ConversationTurn[];
}): PendingConversationState | null {
  if (!input.activeSessionId) {
    return null;
  }

  const latestUnpersistedMessage = [...input.simpleMessages]
    .filter((message) =>
      message.source === 'conversation' &&
      message.sessionId === input.activeSessionId &&
      !hasPersistedUserTurn(message, input.conversationTurns)
    )
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (!latestUnpersistedMessage) {
    return null;
  }

  return {
    input: latestUnpersistedMessage.input,
    status: latestUnpersistedMessage.status,
    statusText: latestUnpersistedMessage.statusText,
    error: latestUnpersistedMessage.error,
    timestamp: latestUnpersistedMessage.timestamp,
    syncState:
      latestUnpersistedMessage.status === 'failed'
        ? 'failed'
        : latestUnpersistedMessage.status === 'completed'
          ? 'syncing_history'
          : 'awaiting_reply',
  };
}
