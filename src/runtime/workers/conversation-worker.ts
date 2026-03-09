import type { IConversationResponse } from '../../app/conversation/session-manager.js';
import type { ConversationPort, ConversationRequest, ConversationResult } from '../conversation-boundary/index.js';

interface ConversationOrchestrator {
  processMessage(
    message: string,
    sessionId?: string,
    personaId?: string,
    userProfileId?: string,
    attachments?: ConversationRequest['attachments'],
    agentId?: string
  ): Promise<IConversationResponse>;
}

export class ConversationWorker implements ConversationPort {
  constructor(private readonly orchestrator: ConversationOrchestrator) {}

  async process(request: ConversationRequest): Promise<ConversationResult> {
    const result = await this.orchestrator.processMessage(
      request.message,
      request.sessionId,
      request.personaId,
      request.userProfileId,
      request.attachments,
      request.agentId
    );

    return {
      conversationRequestId: request.conversationRequestId,
      sessionId: result.sessionId,
      response: result.response,
      state: result.state,
      decision: result.decision,
      decisionReason: result.decisionReason,
      taskInfo: result.taskInfo,
    };
  }
}
