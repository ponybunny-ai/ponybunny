import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IConversationTurn, ConversationLifecycleState } from '../domain/conversation/session.js';
import type { ConversationState } from '../domain/conversation/state-machine-rules.js';
import type { SchedulerCore } from '../scheduler/core/index.js';
import type { LLMService } from '../infra/llm/llm-service.js';
import type { RuntimeToolingContext } from '../runtime/tooling-context/index.js';

import { SessionManager } from '../app/conversation/session-manager.js';
import type { ConversationPort, ConversationRequest, ConversationResult } from '../runtime/conversation-boundary/index.js';
import type { ConversationWorkerInspectionSnapshot } from '../runtime/workers/conversation-worker.js';
import { createDefaultConversationBootstrap } from './conversation-bootstrap/default-conversation-bootstrap.js';
export { SchedulerTaskBridge } from './conversation-bootstrap/scheduler-task-bridge.js';
export { resolveMainAgentModelHintFromAgentConfig } from './conversation-bootstrap/conversation-task-materializer.js';

export interface SchedulerSessionEvent {
  event: string;
  gatewaySessionId?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

interface SessionGatewayBinding {
  gatewaySessionId: string;
  schedulerSessionId: string;
  updatedAt: number;
}

export interface SessionIntakeDependencies {
  repository: IWorkOrderRepository;
  memoryDb: Database.Database;
  llmService: LLMService;
  runtimeToolingContext: RuntimeToolingContext;
  personasDir?: string;
  schedulerProvider: () => SchedulerCore | null;
  publishSessionEvent: (event: SchedulerSessionEvent) => Promise<void>;
  conversationPort?: ConversationPort;
  conversationRequestIdFactory?: () => string;
}

interface SessionStatusResult {
  exists: boolean;
  state?: ConversationState;
  lifecycleState?: ConversationLifecycleState;
  archivedAt?: number;
  turnCount?: number;
}

interface SessionMessageResult {
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

export class SchedulerSessionIntake {
  private sessionManager: SessionManager;
  private conversationPort: ConversationPort;
  private bindingsBySchedulerSession = new Map<string, SessionGatewayBinding>();

  constructor(private deps: SessionIntakeDependencies) {
    const bootstrap = createDefaultConversationBootstrap({
      repository: deps.repository,
      memoryDb: deps.memoryDb,
      llmService: deps.llmService,
      runtimeToolingContext: deps.runtimeToolingContext,
      personasDir: deps.personasDir,
      schedulerProvider: deps.schedulerProvider,
      conversationPort: deps.conversationPort,
    });

    this.sessionManager = bootstrap.sessionManager;
    this.conversationPort = bootstrap.conversationPort;
  }

  async openSession(params: {
    gatewaySessionId: string;
    personaId?: string;
    userProfileId?: string;
    channelType?: string;
    channelSessionId?: string;
  }): Promise<{
    sessionId: string;
    personaId: string;
    state: ConversationState;
    lifecycleState: ConversationLifecycleState;
  }> {
    const session = this.sessionManager.createSession(params.personaId, params.userProfileId);
    this.bindingsBySchedulerSession.set(session.id, {
      gatewaySessionId: params.gatewaySessionId,
      schedulerSessionId: session.id,
      updatedAt: Date.now(),
    });

    await this.publishEvent({
      event: 'conversation.new',
      gatewaySessionId: params.gatewaySessionId,
      sessionId: session.id,
      payload: {
        personaId: session.personaId,
        state: session.state,
        lifecycleState: session.lifecycleState ?? 'active',
        ...(typeof params.channelType === 'string' ? { channelType: params.channelType } : {}),
        ...(typeof params.channelSessionId === 'string' ? { channelSessionId: params.channelSessionId } : {}),
      },
    });

    return {
      sessionId: session.id,
      personaId: session.personaId,
      state: session.state,
      lifecycleState: session.lifecycleState ?? 'active',
    };
  }

  listSessions(params: {
    limit?: number;
    lifecycleState?: ConversationLifecycleState;
  }): {
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
  } {
    return {
      sessions: this.sessionManager.listSessions(params),
    };
  }

  async processMessage(params: {
    gatewaySessionId: string;
    sessionId?: string;
    personaId?: string;
    userProfileId?: string;
    agentId?: string;
    channelType?: string;
    channelSessionId?: string;
    message: string;
    attachments?: Array<{
      type: 'image' | 'file' | 'audio';
      url?: string;
      base64?: string;
      mimeType: string;
      filename?: string;
    }>;
  }): Promise<SessionMessageResult> {
    const conversationRequestId = this.createConversationRequestId();
    const request: ConversationRequest = {
      conversationRequestId,
      message: params.message,
      sessionId: params.sessionId,
      personaId: params.personaId,
      userProfileId: params.userProfileId,
      agentId: params.agentId,
      attachments: params.attachments,
    };

    await this.publishEvent({
      event: 'conversation.message.started',
      gatewaySessionId: params.gatewaySessionId,
      sessionId: params.sessionId,
      payload: {
        stream: false,
        ...(typeof params.channelType === 'string' ? { channelType: params.channelType } : {}),
        ...(typeof params.channelSessionId === 'string' ? { channelSessionId: params.channelSessionId } : {}),
      },
    });

    const result = this.validateConversationResult(
      request,
      await this.conversationPort.process(request)
    );

    this.bindingsBySchedulerSession.set(result.sessionId, {
      gatewaySessionId: params.gatewaySessionId,
      schedulerSessionId: result.sessionId,
      updatedAt: Date.now(),
    });

    await this.publishEvent({
      event: 'conversation.response',
      gatewaySessionId: params.gatewaySessionId,
      sessionId: result.sessionId,
      payload: {
        state: result.state,
        decision: result.decision,
        decisionReason: result.decisionReason,
        hasTask: !!result.taskInfo,
        ...(typeof params.channelType === 'string' ? { channelType: params.channelType } : {}),
        ...(typeof params.channelSessionId === 'string' ? { channelSessionId: params.channelSessionId } : {}),
      },
    });

    await this.publishEvent({
      event: 'conversation.message.succeeded',
      gatewaySessionId: params.gatewaySessionId,
      sessionId: result.sessionId,
      payload: {
        state: result.state,
        decision: result.decision,
        hasTask: !!result.taskInfo,
        stream: false,
        ...(typeof params.channelType === 'string' ? { channelType: params.channelType } : {}),
        ...(typeof params.channelSessionId === 'string' ? { channelSessionId: params.channelSessionId } : {}),
      },
    });

    return {
      sessionId: result.sessionId,
      response: result.response,
      state: result.state,
      decision: result.decision,
      decisionReason: result.decisionReason,
      taskInfo: result.taskInfo,
    };
  }

  getHistory(params: { sessionId: string; limit?: number }): { turns: IConversationTurn[] } {
    return {
      turns: this.sessionManager.getHistory(params.sessionId, params.limit),
    };
  }

  async endSession(params: { sessionId: string }): Promise<{ success: boolean }> {
    const success = this.sessionManager.endSession(params.sessionId);
    if (success) {
      const gatewaySessionId = this.getGatewaySessionId(params.sessionId);
      await this.publishEvent({
        event: 'conversation.ended',
        gatewaySessionId,
        sessionId: params.sessionId,
      });
      this.bindingsBySchedulerSession.delete(params.sessionId);
    }
    return { success };
  }

  async archiveSession(params: { sessionId: string }): Promise<{
    success: boolean;
    archivedAt?: number;
    summary?: string;
  }> {
    const result = this.sessionManager.archiveSession(params.sessionId);
    if (result.success) {
      const gatewaySessionId = this.getGatewaySessionId(params.sessionId);
      await this.publishEvent({
        event: 'conversation.archived',
        gatewaySessionId,
        sessionId: params.sessionId,
        payload: {
          archivedAt: result.snapshot?.archivedAt,
        },
      });
    }

    return {
      success: result.success,
      archivedAt: result.snapshot?.archivedAt,
      summary: result.snapshot?.summary,
    };
  }

  async resumeSession(params: { sessionId: string }): Promise<{ success: boolean }> {
    const success = this.sessionManager.resumeSession(params.sessionId);
    if (success) {
      const gatewaySessionId = this.getGatewaySessionId(params.sessionId);
      await this.publishEvent({
        event: 'conversation.resumed',
        gatewaySessionId,
        sessionId: params.sessionId,
      });
    }
    return { success };
  }

  inspectConversationWorker(): ConversationWorkerInspectionSnapshot | null {
    const inspectablePort = this.conversationPort as ConversationPort & {
      inspect?: () => ConversationWorkerInspectionSnapshot;
    };

    return typeof inspectablePort.inspect === 'function'
      ? inspectablePort.inspect()
      : null;
  }

  getStatus(params: { sessionId: string }): SessionStatusResult {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) return { exists: false };

    return {
      exists: true,
      state: session.state,
      lifecycleState: session.lifecycleState ?? 'active',
      archivedAt: session.archivedAt,
      turnCount: session.turns.length,
    };
  }

  private getGatewaySessionId(sessionId: string): string | undefined {
    return this.bindingsBySchedulerSession.get(sessionId)?.gatewaySessionId;
  }

  private createConversationRequestId(): string {
    return this.deps.conversationRequestIdFactory?.() ?? randomUUID();
  }

  private validateConversationResult(
    request: ConversationRequest,
    result: ConversationResult
  ): ConversationResult {
    const problems: string[] = [];

    if (result.conversationRequestId !== request.conversationRequestId) {
      problems.push(
        `conversationRequestId expected ${request.conversationRequestId}, received ${String(result.conversationRequestId)}`
      );
    }

    if (typeof result.sessionId !== 'string' || result.sessionId.trim().length === 0) {
      problems.push('sessionId must be a non-empty string');
    }

    if (typeof result.response !== 'string') {
      problems.push('response must be a string');
    }

    if (typeof result.state !== 'string') {
      problems.push('state must be a string');
    }

    if (problems.length > 0) {
      throw new Error(
        `Invalid ConversationResult for request '${request.conversationRequestId}': ${problems.join('; ')}`
      );
    }

    return result;
  }

  private async publishEvent(event: SchedulerSessionEvent): Promise<void> {
    await this.deps.publishSessionEvent(event);
  }
}
