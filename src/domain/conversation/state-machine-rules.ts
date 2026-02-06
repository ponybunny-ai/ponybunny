/**
 * Conversation State Machine Rules
 * Defines valid state transitions for conversation flow
 */

export type ConversationState =
  | 'idle'
  | 'chatting'
  | 'clarifying'
  | 'executing'
  | 'monitoring'
  | 'reporting'
  | 'retrying';

export const CONVERSATION_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  idle: ['chatting', 'clarifying', 'executing'],
  chatting: ['idle', 'clarifying', 'executing'],
  clarifying: ['chatting', 'executing', 'idle'],
  executing: ['monitoring', 'reporting', 'retrying'],
  monitoring: ['reporting', 'retrying', 'idle'],
  reporting: ['idle', 'chatting', 'clarifying'],
  retrying: ['executing', 'reporting', 'idle'],
};

export function canTransitionConversation(
  from: ConversationState,
  to: ConversationState
): boolean {
  return CONVERSATION_TRANSITIONS[from].includes(to);
}

export interface IStateTransitionEvent {
  from: ConversationState;
  to: ConversationState;
  trigger: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// State entry conditions
export interface IStateEntryConditions {
  clarifying: {
    hasMissingInfo: boolean;
  };
  executing: {
    hasValidGoal: boolean;
    hasRequiredInfo: boolean;
  };
  monitoring: {
    hasActiveTask: boolean;
  };
  reporting: {
    hasCompletedTask: boolean;
  };
  retrying: {
    hasFailedTask: boolean;
    canAutoRetry: boolean;
  };
}
