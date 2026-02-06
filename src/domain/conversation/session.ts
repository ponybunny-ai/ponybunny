/**
 * Conversation Session Domain Types
 */

import type { ConversationState } from './state-machine-rules.js';

export interface IConversationTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: IAttachment[];
  metadata?: Record<string, unknown>;
}

export interface IAttachment {
  type: 'image' | 'file' | 'audio';
  url?: string;
  base64?: string;
  mimeType: string;
  filename?: string;
}

export interface IConversationSession {
  id: string;
  personaId: string;
  state: ConversationState;
  turns: IConversationTurn[];
  activeGoalId?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ISessionSummary {
  id: string;
  personaId: string;
  state: ConversationState;
  turnCount: number;
  lastMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface IConversationContext {
  session: IConversationSession;
  recentTurns: IConversationTurn[];
  activeTask?: {
    goalId: string;
    status: string;
    progress?: number;
  };
}
