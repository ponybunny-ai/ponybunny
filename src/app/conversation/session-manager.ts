/**
 * Session Manager
 * Manages conversation sessions and coordinates all conversation components
 */

import type {
  ConversationLifecycleState,
  IArchivedSessionSnapshot,
  IAttachment,
  IConversationSession,
  IConversationTurn,
  ISessionSummary,
} from '../../domain/conversation/session.js';
import type { ConversationState } from '../../domain/conversation/state-machine-rules.js';
import type { IPersona } from '../../domain/conversation/persona.js';
import type { IInputAnalysis, IExtractedRequirements } from '../../domain/conversation/analysis.js';
import type { IRetryContext } from '../../domain/conversation/retry.js';
import { ConversationStateMachine } from './conversation-state-machine.js';
import type { IInputAnalysisService } from './input-analysis-service.js';
import type { IResponseGenerator, ITaskProgress, ITaskResult } from './response-generator.js';
import type { IPersonaEngine } from './persona-engine.js';
import type { ITaskBridge } from './task-bridge.js';
import type { IRetryHandler } from './retry-handler.js';
import { debug } from '../../debug/index.js';
import type { IConversationMemoryService, IRecalledMemory } from './memory-service.js';
import type { IMemoryOwnerScope } from './memory-service.js';

export interface ISessionRepository {
  createSession(personaId: string): IConversationSession;
  getSession(id: string): IConversationSession | null;
  updateSession(session: IConversationSession): void;
  addTurn(sessionId: string, turn: IConversationTurn): void;
  deleteSession(id: string): boolean;
  listSessions(limit?: number): IConversationSession[];
  listSessionsSummary(options?: {
    limit?: number;
    lifecycleState?: ConversationLifecycleState;
  }): ISessionSummary[];
  archiveSession(sessionId: string, snapshot: IArchivedSessionSnapshot): boolean;
  resumeSession(sessionId: string): boolean;
}

export interface IConversationResponse {
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

export interface ISessionManager {
  processMessage(
    message: string,
    sessionId?: string,
    personaId?: string,
    userProfileId?: string,
    attachments?: IAttachment[]
  ): Promise<IConversationResponse>;

  processMessageWithStream(
    message: string,
    sessionId: string | undefined,
    personaId: string | undefined,
    userProfileId: string | undefined,
    attachments: IAttachment[] | undefined,
    onChunk: (chunk: string) => void
  ): Promise<IConversationResponse>;

  getSession(sessionId: string): IConversationSession | null;
  getHistory(sessionId: string, limit?: number): IConversationTurn[];
  createSession(personaId?: string, userProfileId?: string): IConversationSession;
  listSessions(options?: {
    limit?: number;
    lifecycleState?: ConversationLifecycleState;
  }): ISessionSummary[];
  archiveSession(sessionId: string): { success: boolean; snapshot?: IArchivedSessionSnapshot };
  resumeSession(sessionId: string): boolean;
  endSession(sessionId: string): boolean;
}

export class SessionManager implements ISessionManager {
  private stateMachines = new Map<string, ConversationStateMachine>();
  private retryContexts = new Map<string, IRetryContext>();

  constructor(
    private sessionRepository: ISessionRepository,
    private personaEngine: IPersonaEngine,
    private inputAnalyzer: IInputAnalysisService,
    private responseGenerator: IResponseGenerator,
    private taskBridge: ITaskBridge,
    private retryHandler: IRetryHandler,
    private memoryService?: IConversationMemoryService,
    private memoryConfig: {
      autoSave: boolean;
      vectorWeight: number;
      keywordWeight: number;
      defaultUserProfileId: string;
    } = {
      autoSave: true,
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      defaultUserProfileId: 'local-default-user',
    }
  ) {}

  async processMessage(
    message: string,
    sessionId?: string,
    personaId?: string,
    userProfileId?: string,
    attachments?: IAttachment[]
  ): Promise<IConversationResponse> {
    return this.processMessageInternal(message, sessionId, personaId, userProfileId, attachments, undefined);
  }

  async processMessageWithStream(
    message: string,
    sessionId: string | undefined,
    personaId: string | undefined,
    userProfileId: string | undefined,
    attachments: IAttachment[] | undefined,
    onChunk: (chunk: string) => void
  ): Promise<IConversationResponse> {
    return this.processMessageInternal(message, sessionId, personaId, userProfileId, attachments, onChunk);
  }

  private async processMessageInternal(
    message: string,
    sessionId?: string,
    personaId?: string,
    userProfileId?: string,
    attachments?: IAttachment[],
    onChunk?: (chunk: string) => void
  ): Promise<IConversationResponse> {
    debug.custom('session.process.start', 'session-manager', {
      sessionId,
      messagePreview: message.slice(0, 100),
      hasAttachments: !!(attachments && attachments.length > 0),
    });

    // Get or create session
    let session: IConversationSession;
    if (sessionId) {
      const existing = this.sessionRepository.getSession(sessionId);
      if (existing) {
        session = existing;
        if (session.lifecycleState === 'archived') {
          this.sessionRepository.resumeSession(session.id);
          session.lifecycleState = 'active';
          session.archivedAt = undefined;
        }
      } else {
        session = this.sessionRepository.createSession(
          personaId || this.personaEngine.getDefaultPersonaId()
        );
      }
    } else {
      session = this.sessionRepository.createSession(
        personaId || this.personaEngine.getDefaultPersonaId()
      );
    }

    if (userProfileId && userProfileId.trim().length > 0) {
      const profileId = userProfileId.trim();
      const metadata = { ...(session.metadata ?? {}) };
      if (metadata.userProfileId !== profileId) {
        metadata.userProfileId = profileId;
        session.metadata = metadata;
        this.sessionRepository.updateSession(session);
      }
    }

    if (!this.getSessionTitle(session) && message.trim().length > 0) {
      const metadata = { ...(session.metadata ?? {}) };
      metadata.title = this.deriveSessionTitle(message);
      session.metadata = metadata;
      this.sessionRepository.updateSession(session);
    }

    // Get or create state machine for this session
    let stateMachine = this.stateMachines.get(session.id);
    if (!stateMachine) {
      stateMachine = new ConversationStateMachine(session.state);
      this.stateMachines.set(session.id, stateMachine);
    }

    // Add user turn
    const userTurn: IConversationTurn = {
      id: `turn-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
      attachments,
    };
    this.sessionRepository.addTurn(session.id, userTurn);
    if (this.memoryService && this.memoryConfig.autoSave) {
      await this.indexTurnSafely(session, userTurn);
    }

    // Get persona
    const persona = await this.personaEngine.getPersona(session.personaId);
    if (!persona) {
      throw new Error(`Persona not found: ${session.personaId}`);
    }

    // Analyze input
    const recentTurns = this.getHistory(session.id, 10);
    const recalledMemories = await this.recallMemories(session, message);
    const contextTurns = this.mergeTurnContext(recentTurns, recalledMemories, 16);
    const analysis = await this.inputAnalyzer.analyze(message, contextTurns);

    debug.custom('session.analysis.complete', 'session-manager', {
      sessionId: session.id,
      intent: analysis.intent.primary,
      intentConfidence: analysis.intent.confidence,
      emotion: analysis.emotion.primary,
      urgency: analysis.emotion.urgency,
      isActionable: analysis.purpose.isActionable,
    });

    // Determine and transition to next state
    const hasActiveTask = !!session.activeGoalId;
    const nextState = stateMachine.determineNextState(analysis, hasActiveTask);

    if (nextState !== stateMachine.getCurrentState()) {
      stateMachine.transition(nextState, analysis.intent.primary);
    }

    // Handle based on state
    let response: string;
    let taskInfo: IConversationResponse['taskInfo'] | undefined;

    debug.custom('session.state.handling', 'session-manager', {
      sessionId: session.id,
      currentState: stateMachine.getCurrentState(),
    });

    switch (stateMachine.getCurrentState()) {
      case 'executing':
        const result = await this.handleExecuting(session, analysis, persona, userTurn.id, onChunk);
        response = result.response;
        taskInfo = result.taskInfo;
        break;

      case 'monitoring':
        const monitorResult = await this.handleMonitoring(session, persona, onChunk);
        response = monitorResult.response;
        taskInfo = monitorResult.taskInfo;
        break;

      case 'retrying':
        response = await this.handleRetrying(session, persona, onChunk);
        break;

      default:
        response = await this.responseGenerator.generate({
          persona,
          analysis,
          conversationState: stateMachine.getCurrentState(),
          recentTurns: contextTurns,
          taskInfo: session.activeGoalId ? {
            goalId: session.activeGoalId,
            status: 'active',
          } : undefined,
        }, onChunk);
    }

    // Add assistant turn
    const assistantTurn: IConversationTurn = {
      id: `turn-${Date.now()}`,
      role: 'assistant',
      content: response,
      timestamp: Date.now(),
    };
    this.sessionRepository.addTurn(session.id, assistantTurn);
    if (this.memoryService && this.memoryConfig.autoSave) {
      await this.indexTurnSafely(session, assistantTurn);
    }

    // Update session state
    session.state = stateMachine.getCurrentState();
    session.updatedAt = Date.now();
    this.sessionRepository.updateSession(session);

    debug.custom('session.process.complete', 'session-manager', {
      sessionId: session.id,
      responseLength: response.length,
      finalState: stateMachine.getCurrentState(),
      hasTask: !!taskInfo,
    });

    let decision: IConversationResponse['decision'];
    let decisionReason: string;
    if (taskInfo) {
      decision = 'goal_created';
      decisionReason = 'Task bridge created executable goal from conversation intent.';
    } else if (stateMachine.getCurrentState() === 'clarifying') {
      decision = 'clarification_requested';
      decisionReason = 'Conversation requested clarification before creating an executable goal.';
    } else {
      decision = 'response_only';
      decisionReason = 'Session responded conversationally without creating a goal.';
    }

    return {
      sessionId: session.id,
      response,
      state: stateMachine.getCurrentState(),
      decision,
      decisionReason,
      taskInfo,
    };
  }

  private async handleExecuting(
    session: IConversationSession,
    analysis: IInputAnalysis,
    persona: IPersona,
    sourceTurnId: string,
    onChunk?: (chunk: string) => void
  ): Promise<{ response: string; taskInfo?: IConversationResponse['taskInfo'] }> {
    // Extract requirements from analysis
    const requirements: IExtractedRequirements = {
      title: analysis.purpose.extractedGoal || 'User Task',
      description: analysis.rawInput,
      successCriteria: analysis.purpose.successCriteria || ['Task completed successfully'],
      constraints: analysis.purpose.constraints,
      priority: analysis.emotion.urgency === 'critical' ? 'high' :
                analysis.emotion.urgency === 'high' ? 'high' : 'medium',
    };

    // Create goal via task bridge
    const result = await this.taskBridge.createGoalFromConversation(requirements, session, sourceTurnId);

    // Update session with active goal
    session.activeGoalId = result.goalId;
    this.sessionRepository.updateSession(session);

    // Subscribe to progress updates
    this.taskBridge.subscribeToProgress(result.goalId, (progress) => {
      // Progress updates will be handled by the monitoring state
      debug.custom('session.progress.update', 'session-manager', {
        goalId: result.goalId,
        status: progress.goalStatus,
        completedItems: progress.completedItems,
        totalItems: progress.totalItems,
      });
    });

    // Generate confirmation response
    const response = await this.responseGenerator.generate({
      persona,
      analysis,
      conversationState: 'executing',
      recentTurns: this.getHistory(session.id, 5),
      taskInfo: {
        goalId: result.goalId,
        status: 'started',
      },
    }, onChunk);

    return {
      response,
      taskInfo: {
        goalId: result.goalId,
        status: 'started',
        progress: 0,
      },
    };
  }

  private async handleMonitoring(
    session: IConversationSession,
    persona: IPersona,
    onChunk?: (chunk: string) => void
  ): Promise<{ response: string; taskInfo?: IConversationResponse['taskInfo'] }> {
    if (!session.activeGoalId) {
      return {
        response: 'No active task to monitor.',
      };
    }

    const progress = await this.taskBridge.getTaskStatus(session.activeGoalId);
    if (!progress) {
      return {
        response: 'Unable to retrieve task status.',
      };
    }

    const response = await this.responseGenerator.generateProgressNarration(
      {
        goalId: progress.goalId,
        completedSteps: progress.completedItems,
        totalSteps: progress.totalItems,
        currentStep: progress.currentItem?.title || 'Processing...',
        elapsedTime: Date.now() - progress.startedAt,
      },
      persona,
      onChunk
    );

    return {
      response,
      taskInfo: {
        goalId: progress.goalId,
        status: progress.goalStatus,
        progress: progress.completedItems / Math.max(progress.totalItems, 1),
      },
    };
  }

  private async handleRetrying(
    session: IConversationSession,
    persona: IPersona,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    // Get or initialize retry context
    let retryContext = this.retryContexts.get(session.id);
    if (!retryContext) {
      retryContext = {
        attemptNumber: 1,
        maxAttempts: 3,
        previousStrategies: [],
        failureHistory: [],
      };
      this.retryContexts.set(session.id, retryContext);
    }

    // For now, return a message indicating retry is in progress
    return `I encountered an issue and am retrying. Attempt ${retryContext.attemptNumber} of ${retryContext.maxAttempts}.`;
  }

  getSession(sessionId: string): IConversationSession | null {
    return this.sessionRepository.getSession(sessionId);
  }

  createSession(personaId?: string, userProfileId?: string): IConversationSession {
    const session = this.sessionRepository.createSession(personaId || this.personaEngine.getDefaultPersonaId());
    if (userProfileId && userProfileId.trim().length > 0) {
      session.metadata = {
        ...(session.metadata ?? {}),
        userProfileId: userProfileId.trim(),
      };
      this.sessionRepository.updateSession(session);
    }
    return session;
  }

  listSessions(options?: {
    limit?: number;
    lifecycleState?: ConversationLifecycleState;
  }): ISessionSummary[] {
    return this.sessionRepository.listSessionsSummary(options);
  }

  getHistory(sessionId: string, limit?: number): IConversationTurn[] {
    const session = this.sessionRepository.getSession(sessionId);
    if (!session) {
      return [];
    }
    const turns = session.turns;
    return limit ? turns.slice(-limit) : turns;
  }

  archiveSession(sessionId: string): { success: boolean; snapshot?: IArchivedSessionSnapshot } {
    const session = this.sessionRepository.getSession(sessionId);
    if (!session || session.lifecycleState === 'archived') {
      return { success: false };
    }

    const snapshot = this.buildArchiveSnapshot(session);
    this.stateMachines.delete(sessionId);
    this.retryContexts.delete(sessionId);
    const success = this.sessionRepository.archiveSession(sessionId, snapshot);
    if (!success) {
      return { success: false };
    }

    return { success: true, snapshot };
  }

  resumeSession(sessionId: string): boolean {
    return this.sessionRepository.resumeSession(sessionId);
  }

  endSession(sessionId: string): boolean {
    this.stateMachines.delete(sessionId);
    this.retryContexts.delete(sessionId);
    return this.sessionRepository.deleteSession(sessionId);
  }

  private buildArchiveSnapshot(session: IConversationSession): IArchivedSessionSnapshot {
    const archivedAt = Date.now();
    const userTurns = session.turns.filter((turn) => turn.role === 'user');
    const assistantTurns = session.turns.filter((turn) => turn.role === 'assistant');
    const firstUserTurn = userTurns[0];
    const lastUserTurn = userTurns[userTurns.length - 1];
    const lastAssistantTurn = assistantTurns[assistantTurns.length - 1];

    const summaryParts = [
      `Conversation with ${session.personaId} archived after ${session.turns.length} turns.`,
      firstUserTurn ? `Started with: ${firstUserTurn.content.slice(0, 160)}` : undefined,
      lastUserTurn ? `Last user intent: ${lastUserTurn.content.slice(0, 160)}` : undefined,
      lastAssistantTurn ? `Last assistant response: ${lastAssistantTurn.content.slice(0, 160)}` : undefined,
    ].filter((part): part is string => !!part);

    return {
      archivedAt,
      summary: summaryParts.join(' '),
      metadata: {
        turnCount: session.turns.length,
        activeGoalId: session.activeGoalId ?? null,
        personaId: session.personaId,
        firstTurnAt: session.turns[0]?.timestamp ?? null,
        lastTurnAt: session.turns[session.turns.length - 1]?.timestamp ?? null,
      },
    };
  }

  private async recallMemories(session: IConversationSession, query: string): Promise<IRecalledMemory[]> {
    if (!this.memoryService) {
      return [];
    }

    try {
      return await this.memoryService.retrieveRelevantMemories(session.id, query, {
        limit: 6,
        vectorWeight: this.memoryConfig.vectorWeight,
        keywordWeight: this.memoryConfig.keywordWeight,
        coreOwnerScopes: this.getCoreOwnerScopes(session),
      });
    } catch (error) {
      debug.custom('session.memory.recall.error', 'session-manager', {
        sessionId: session.id,
        error: (error as Error).message,
      });
      return [];
    }
  }

  private async indexTurnSafely(session: IConversationSession, turn: IConversationTurn): Promise<void> {
    if (!this.memoryService) {
      return;
    }

    try {
      await this.memoryService.indexTurn(session.id, turn, this.getOwnerScopeForTurn(session, turn));
    } catch (error) {
      debug.custom('session.memory.index.error', 'session-manager', {
        sessionId: session.id,
        turnId: turn.id,
        error: (error as Error).message,
      });
    }
  }

  private getOwnerScopeForTurn(session: IConversationSession, turn: IConversationTurn): IMemoryOwnerScope {
    if (turn.role === 'assistant') {
      return {
        ownerType: 'agent',
        ownerId: session.personaId || 'default-agent',
      };
    }

    return {
      ownerType: 'user',
      ownerId: this.getUserProfileId(session),
    };
  }

  private getCoreOwnerScopes(session: IConversationSession): IMemoryOwnerScope[] {
    return [
      {
        ownerType: 'agent',
        ownerId: session.personaId || 'default-agent',
      },
      {
        ownerType: 'user',
        ownerId: this.getUserProfileId(session),
      },
    ];
  }

  private getUserProfileId(session: IConversationSession): string {
    const value = session.metadata?.userProfileId;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return this.memoryConfig.defaultUserProfileId;
  }

  private deriveSessionTitle(message: string): string {
    const normalized = message.trim();
    return normalized.length > 64 ? `${normalized.slice(0, 64)}...` : normalized;
  }

  private getSessionTitle(session: IConversationSession): string | undefined {
    const value = session.metadata?.title;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private mergeTurnContext(
    recentTurns: IConversationTurn[],
    recalledMemories: IRecalledMemory[],
    limit: number
  ): IConversationTurn[] {
    if (recalledMemories.length === 0) {
      return recentTurns;
    }

    const memoryTurns: IConversationTurn[] = recalledMemories.map((memory) => ({
      id: `memory-${memory.entryId}`,
      role: memory.role,
      content: `[Memory Recall] ${memory.content}`,
      timestamp: memory.createdAt,
      metadata: {
        source: 'memory',
        entryId: memory.entryId,
        score: memory.score,
      },
    }));

    return [...memoryTurns, ...recentTurns].slice(-limit);
  }
}
