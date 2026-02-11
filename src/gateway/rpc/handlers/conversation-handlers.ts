/**
 * Conversation Handlers - RPC handlers for conversation operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError } from '../../errors.js';
import type { EventBus } from '../../events/event-bus.js';
import type { ISessionManager, IConversationResponse } from '../../../app/conversation/session-manager.js';
import type { IConversationTurn, IAttachment } from '../../../domain/conversation/session.js';
import type { ConversationState } from '../../../domain/conversation/state-machine-rules.js';
import { debug } from '../../../debug/index.js';

export interface ConversationMessageParams {
  sessionId?: string;
  personaId?: string;
  message: string;
  attachments?: IAttachment[];
  stream?: boolean;
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

      debug.custom('conversation.message.received', 'gateway', {
        sessionId: params.sessionId,
        messageLength: params.message.length,
        hasAttachments: !!(params.attachments && params.attachments.length > 0),
        stream: params.stream,
      });

      try {
        // If streaming is requested, handle it differently
        if (params.stream) {
          const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;

          // Emit stream start event
          eventBus.emit('conversation.stream.start', {
            streamId,
            sessionId: params.sessionId,
            timestamp: Date.now(),
          });

          // Process message with streaming callback
          const result = await sessionManager.processMessageWithStream(
            params.message,
            params.sessionId,
            params.personaId,
            params.attachments,
            (chunk: string) => {
              // Emit each chunk as an event
              eventBus.emit('conversation.stream.chunk', {
                streamId,
                chunk,
                timestamp: Date.now(),
              });
            }
          );

          // Emit stream end event
          eventBus.emit('conversation.stream.end', {
            streamId,
            sessionId: result.sessionId,
            timestamp: Date.now(),
          });

          debug.custom('conversation.message.streamed', 'gateway', {
            sessionId: result.sessionId,
            streamId,
            responseLength: result.response.length,
            state: result.state,
          });

          return result;
        }

        // Non-streaming path (original behavior)
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

        debug.custom('conversation.message.completed', 'gateway', {
          sessionId: result.sessionId,
          responseLength: result.response.length,
          state: result.state,
          hasTask: !!result.taskInfo,
        });

        return result;
      } catch (error) {
        debug.custom('conversation.message.error', 'gateway', {
          sessionId: params.sessionId,
          error: (error as Error).message,
        });
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
