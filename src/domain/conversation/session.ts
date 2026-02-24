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
  lifecycleState?: ConversationLifecycleState;
  turns: IConversationTurn[];
  activeGoalId?: string;
  archivedAt?: number;
  archiveSummary?: string;
  archiveMetadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export type ConversationLifecycleState = 'active' | 'archived';

export interface IArchivedSessionSnapshot {
  summary: string;
  metadata: Record<string, unknown>;
  archivedAt: number;
}

export interface ISessionSummary {
  id: string;
  personaId: string;
  state: ConversationState;
  lifecycleState: ConversationLifecycleState;
  archivedAt?: number;
  archiveSummary?: string;
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
