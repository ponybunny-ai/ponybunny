/**
 * Conversation Handlers - RPC handlers for conversation operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError } from '../../errors.js';
import type { EventBus } from '../../events/event-bus.js';
import type { ISessionManager, IConversationResponse } from '../../../app/conversation/session-manager.js';
import type { IConversationTurn, IAttachment } from '../../../domain/conversation/session.js';
import type { ConversationState } from '../../../domain/conversation/state-machine-rules.js';

export interface ConversationMessageParams {
  sessionId?: string;
  personaId?: string;
  message: string;
  attachments?: IAttachment[];
}

export interface ConversationHistoryParams {
  sessionId: string;
  limit?: number;
}

export interface ConversationEndParams {
  sessionId: string;
}

export interface ConversationMessageResult {
  sessionId: string;
  response: string;
  state: ConversationState;
  taskInfo?: {
    goalId: string;
    status: string;
    progress?: number;
  };
}

export interface ConversationHistoryResult {
  turns: IConversationTurn[];
}

export function registerConversationHandlers(
  rpcHandler: RpcHandler,
  sessionManager: ISessionManager,
  eventBus: EventBus
): void {
  // conversation.message - Send a message and get a response
  rpcHandler.register<ConversationMessageParams, ConversationMessageResult>(
    'conversation.message',
    ['write'],
    async (params, session) => {
      if (!params.message || params.message.trim().length === 0) {
        throw GatewayError.invalidParams('message is required');
      }

      try {
        const result = await sessionManager.processMessage(
          params.message,
          params.sessionId,
          params.personaId,
          params.attachments
        );

        // Emit event for new conversation activity
        eventBus.emit('conversation.response', {
          sessionId: result.sessionId,
          state: result.state,
          hasTask: !!result.taskInfo,
        });

        return result;
      } catch (error) {
        throw GatewayError.internalError(`Failed to process message: ${(error as Error).message}`);
      }
    }
  );

  // conversation.history - Get conversation history
  rpcHandler.register<ConversationHistoryParams, ConversationHistoryResult>(
    'conversation.history',
    ['read'],
    async (params) => {
      if (!params.sessionId) {
        throw GatewayError.invalidParams('sessionId is required');
      }

      const turns = sessionManager.getHistory(params.sessionId, params.limit);

      return { turns };
    }
  );

  // conversation.end - End a conversation session
  rpcHandler.register<ConversationEndParams, { success: boolean }>(
    'conversation.end',
    ['write'],
    async (params) => {
      if (!params.sessionId) {
        throw GatewayError.invalidParams('sessionId is required');
      }

      const success = sessionManager.endSession(params.sessionId);

      if (success) {
        eventBus.emit('conversation.ended', {
          sessionId: params.sessionId,
        });
      }

      return { success };
    }
  );

  // conversation.status - Get session status
  rpcHandler.register<{ sessionId: string }, { exists: boolean; state?: ConversationState; turnCount?: number }>(
    'conversation.status',
    ['read'],
    async (params) => {
      if (!params.sessionId) {
        throw GatewayError.invalidParams('sessionId is required');
      }

      const session = sessionManager.getSession(params.sessionId);

      if (!session) {
        return { exists: false };
      }

      return {
        exists: true,
        state: session.state,
        turnCount: session.turns.length,
      };
    }
  );
}
