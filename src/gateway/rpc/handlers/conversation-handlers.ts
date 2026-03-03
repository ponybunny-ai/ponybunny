/**
 * Conversation Handlers - RPC handlers for conversation operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError } from '../../errors.js';
import type { EventBus } from '../../events/event-bus.js';
import type { ISessionManager } from '../../../app/conversation/session-manager.js';
import type { IConversationTurn, IAttachment } from '../../../domain/conversation/session.js';
import type { ConversationLifecycleState } from '../../../domain/conversation/session.js';
import type { ConversationState } from '../../../domain/conversation/state-machine-rules.js';
import { debug } from '../../../debug/index.js';

export interface ConversationNewParams {
  personaId?: string;
  userProfileId?: string;
}

export interface ConversationNewResult {
  sessionId: string;
  personaId: string;
  state: ConversationState;
  lifecycleState: ConversationLifecycleState;
}

export interface ConversationListParams {
  limit?: number;
  lifecycleState?: ConversationLifecycleState;
}

export interface ConversationArchiveParams {
  sessionId: string;
}

export interface ConversationResumeParams {
  sessionId: string;
}

export interface ConversationMessageParams {
  sessionId?: string;
  personaId?: string;
  userProfileId?: string;
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
  decision?: 'goal_created' | 'clarification_requested' | 'response_only';
  decisionReason?: string;
  taskInfo?: {
    goalId: string;
    status: string;
    progress?: number;
  };
}

export interface ConversationHistoryResult {
  turns: IConversationTurn[];
}

export interface ConversationListResult {
  sessions: Array<{
    id: string;
    personaId: string;
    title?: string;
    state: ConversationState;
    lifecycleState: ConversationLifecycleState;
    archivedAt?: number;
    archiveSummary?: string;
    turnCount: number;
    lastMessage?: string;
    createdAt: number;
    updatedAt: number;
  }>;
}

export function registerConversationHandlers(
  rpcHandler: RpcHandler,
  sessionManager: ISessionManager,
  eventBus: EventBus
): void {
  rpcHandler.register<ConversationNewParams, ConversationNewResult>(
    'conversation.new',
    ['write'],
    async (params) => {
      try {
        const session = sessionManager.createSession(params.personaId, params.userProfileId);
        eventBus.emit('conversation.new', {
          sessionId: session.id,
          personaId: session.personaId,
          state: session.state,
          lifecycleState: session.lifecycleState ?? 'active',
          timestamp: Date.now(),
        });
        return {
          sessionId: session.id,
          personaId: session.personaId,
          state: session.state,
          lifecycleState: session.lifecycleState ?? 'active',
        };
      } catch (error) {
        eventBus.emit('conversation.new.failed', {
          personaId: params.personaId,
          userProfileId: params.userProfileId,
          error: (error as Error).message,
          timestamp: Date.now(),
        });
        throw GatewayError.internalError(`Failed to create conversation session: ${(error as Error).message}`);
      }
    }
  );

  rpcHandler.register<ConversationListParams, ConversationListResult>(
    'conversation.list',
    ['read'],
    async (params) => {
      const sessions = sessionManager.listSessions({
        limit: params.limit,
        lifecycleState: params.lifecycleState,
      });
      return { sessions };
    }
  );

  // conversation.message - Send a message and get a response
  rpcHandler.register<ConversationMessageParams, ConversationMessageResult>(
    'conversation.message',
    ['write'],
    async (params) => {
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
        eventBus.emit('conversation.message.started', {
          sessionId: params.sessionId,
          timestamp: Date.now(),
        });

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
            params.userProfileId,
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

          eventBus.emit('conversation.message.succeeded', {
            sessionId: result.sessionId,
            state: result.state,
            decision: result.decision,
            hasTask: !!result.taskInfo,
            stream: true,
            timestamp: Date.now(),
          });

          return result;
        }

        // Non-streaming path (original behavior)
        const result = await sessionManager.processMessage(
          params.message,
          params.sessionId,
          params.personaId,
          params.userProfileId,
          params.attachments
        );

        // Emit event for new conversation activity
        eventBus.emit('conversation.response', {
          sessionId: result.sessionId,
          state: result.state,
          decision: result.decision,
          decisionReason: result.decisionReason,
          hasTask: !!result.taskInfo,
        });
        eventBus.emit('conversation.message.succeeded', {
          sessionId: result.sessionId,
          state: result.state,
          decision: result.decision,
          hasTask: !!result.taskInfo,
          stream: false,
          timestamp: Date.now(),
        });

        debug.custom('conversation.message.completed', 'gateway', {
          sessionId: result.sessionId,
          responseLength: result.response.length,
          state: result.state,
          hasTask: !!result.taskInfo,
        });

        return result;
      } catch (error) {
        eventBus.emit('conversation.message.failed', {
          sessionId: params.sessionId,
          stream: params.stream,
          error: (error as Error).message,
          timestamp: Date.now(),
        });
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

  rpcHandler.register<ConversationArchiveParams, { success: boolean; archivedAt?: number; summary?: string }>(
    'conversation.archive',
    ['write'],
    async (params) => {
      if (!params.sessionId) {
        throw GatewayError.invalidParams('sessionId is required');
      }

      const result = sessionManager.archiveSession(params.sessionId);
      if (result.success) {
        eventBus.emit('conversation.archived', {
          sessionId: params.sessionId,
          archivedAt: result.snapshot?.archivedAt,
        });
      }

      return {
        success: result.success,
        archivedAt: result.snapshot?.archivedAt,
        summary: result.snapshot?.summary,
      };
    }
  );

  rpcHandler.register<ConversationResumeParams, { success: boolean }>(
    'conversation.resume',
    ['write'],
    async (params) => {
      if (!params.sessionId) {
        throw GatewayError.invalidParams('sessionId is required');
      }

      const success = sessionManager.resumeSession(params.sessionId);
      if (success) {
        eventBus.emit('conversation.resumed', {
          sessionId: params.sessionId,
        });
      }

      return { success };
    }
  );

  // conversation.status - Get session status
  rpcHandler.register<{ sessionId: string }, {
    exists: boolean;
    state?: ConversationState;
    lifecycleState?: ConversationLifecycleState;
    archivedAt?: number;
    turnCount?: number;
  }>(
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
        lifecycleState: session.lifecycleState ?? 'active',
        archivedAt: session.archivedAt,
        turnCount: session.turns.length,
      };
    }
  );
}
