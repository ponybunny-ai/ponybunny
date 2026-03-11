import type { IAttachment } from '../../domain/conversation/session.js';
import type { ConversationState } from '../../domain/conversation/state-machine-rules.js';

export interface ConversationRequest {
  conversationRequestId: string;
  message: string;
  sessionId?: string;
  personaId?: string;
  userProfileId?: string;
  agentId?: string;
  attachments?: IAttachment[];
}

export interface ConversationResult {
  conversationRequestId: string;
  sessionId: string;
  response: string;
  state: ConversationState;
  decision?: 'goal_created' | 'clarification_requested' | 'response_only';
  decisionReason?: string;
  taskInfo?: {
    goalId: string;
    status: string;
    progress?: number;
  };
}

export interface ConversationPort {
  process(request: ConversationRequest): Promise<ConversationResult>;
}
