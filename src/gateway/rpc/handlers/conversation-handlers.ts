/**
 * Conversation Handlers - RPC handlers for conversation operations
 */

import type { RpcHandler } from '../rpc-handler.js';
import { GatewayError } from '../../errors.js';
import type { EventBus } from '../../events/event-bus.js';
import type { IConversationTurn, IAttachment } from '../../../domain/conversation/session.js';
import type { ConversationLifecycleState } from '../../../domain/conversation/session.js';
import type { ConversationState } from '../../../domain/conversation/state-machine-rules.js';
import { debug } from '../../../debug/index.js';
import type { IPCBridge } from '../../integration/ipc-bridge.js';

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
  agentId?: string;
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
  eventBus: EventBus,
  ipcBridge: IPCBridge
): void {
  rpcHandler.register<ConversationNewParams, ConversationNewResult>(
    'conversation.new',
    ['write'],
    async (params, session) => {
      try {
        const metadata = session.metadata ?? {};
        const channelType = typeof metadata.channelType === 'string' ? metadata.channelType : undefined;
        const channelSessionId = typeof metadata.channelSessionId === 'string'
          ? metadata.channelSessionId
          : undefined;

        const result = await ipcBridge.openSession({
          gatewaySessionId: session.id,
          personaId: params.personaId,
          userProfileId: params.userProfileId,
          channelType,
          channelSessionId,
        });

        return {
          sessionId: result.sessionId,
          personaId: result.personaId,
          state: result.state,
          lifecycleState: result.lifecycleState,
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
    async (params, _session) => {
      const { sessions } = await ipcBridge.listSessions({
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
        const metadata = session.metadata ?? {};
        const channelType = typeof metadata.channelType === 'string' ? metadata.channelType : undefined;
        const channelSessionId = typeof metadata.channelSessionId === 'string'
          ? metadata.channelSessionId
          : undefined;

        const result = await ipcBridge.sendSessionMessage({
          gatewaySessionId: session.id,
          sessionId: params.sessionId,
          personaId: params.personaId,
          userProfileId: params.userProfileId,
          agentId: params.agentId,
          message: params.message,
          attachments: params.attachments,
          stream: params.stream,
          channelType,
          channelSessionId,
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

      const { turns } = await ipcBridge.getSessionHistory({
        sessionId: params.sessionId,
        limit: params.limit,
      });

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

      const { success } = await ipcBridge.endSession({ sessionId: params.sessionId });

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

      const result = await ipcBridge.archiveSession({ sessionId: params.sessionId });

      return {
        success: result.success,
        archivedAt: result.archivedAt,
        summary: result.summary,
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

      const { success } = await ipcBridge.resumeSession({ sessionId: params.sessionId });

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

      return await ipcBridge.getSessionStatus({ sessionId: params.sessionId });
    }
  );
}
