/**
 * Session Manager
 * Manages conversation sessions and coordinates all conversation components
 */

import type { IConversationSession, IConversationTurn, IAttachment } from '../../domain/conversation/session.js';
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

export interface ISessionRepository {
  createSession(personaId: string): IConversationSession;
  getSession(id: string): IConversationSession | null;
  updateSession(session: IConversationSession): void;
  addTurn(sessionId: string, turn: IConversationTurn): void;
  deleteSession(id: string): boolean;
  listSessions(limit?: number): IConversationSession[];
}

export interface IConversationResponse {
  sessionId: string;
  response: string;
  state: ConversationState;
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
    attachments?: IAttachment[]
  ): Promise<IConversationResponse>;

  processMessageWithStream(
    message: string,
    sessionId: string | undefined,
    personaId: string | undefined,
    attachments: IAttachment[] | undefined,
    onChunk: (chunk: string) => void
  ): Promise<IConversationResponse>;

  getSession(sessionId: string): IConversationSession | null;
  getHistory(sessionId: string, limit?: number): IConversationTurn[];
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
    private retryHandler: IRetryHandler
  ) {}

  async processMessage(
    message: string,
    sessionId?: string,
    personaId?: string,
    attachments?: IAttachment[]
  ): Promise<IConversationResponse> {
    return this.processMessageInternal(message, sessionId, personaId, attachments, undefined);
  }

  async processMessageWithStream(
    message: string,
    sessionId: string | undefined,
    personaId: string | undefined,
    attachments: IAttachment[] | undefined,
    onChunk: (chunk: string) => void
  ): Promise<IConversationResponse> {
    return this.processMessageInternal(message, sessionId, personaId, attachments, onChunk);
  }

  private async processMessageInternal(
    message: string,
    sessionId?: string,
    personaId?: string,
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

    // Get persona
    const persona = await this.personaEngine.getPersona(session.personaId);
    if (!persona) {
      throw new Error(`Persona not found: ${session.personaId}`);
    }

    // Analyze input
    const recentTurns = this.getHistory(session.id, 10);
    const analysis = await this.inputAnalyzer.analyze(message, recentTurns);

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
        const result = await this.handleExecuting(session, analysis, persona, onChunk);
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
          recentTurns,
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

    return {
      sessionId: session.id,
      response,
      state: stateMachine.getCurrentState(),
      taskInfo,
    };
  }

  private async handleExecuting(
    session: IConversationSession,
    analysis: IInputAnalysis,
    persona: IPersona,
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
    const result = await this.taskBridge.createGoalFromConversation(requirements, session);

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

  getHistory(sessionId: string, limit?: number): IConversationTurn[] {
    const session = this.sessionRepository.getSession(sessionId);
    if (!session) {
      return [];
    }
    const turns = session.turns;
    return limit ? turns.slice(-limit) : turns;
  }

  endSession(sessionId: string): boolean {
    this.stateMachines.delete(sessionId);
    this.retryContexts.delete(sessionId);
    return this.sessionRepository.deleteSession(sessionId);
  }
}
