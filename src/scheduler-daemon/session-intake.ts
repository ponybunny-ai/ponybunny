import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { IWorkOrderRepository } from '../infra/persistence/repository-interface.js';
import type { IConversationTurn, ConversationLifecycleState } from '../domain/conversation/session.js';
import type { ConversationState } from '../domain/conversation/state-machine-rules.js';
import type { Goal } from '../work-order/types/index.js';
import type { SchedulerCore } from '../scheduler/core/index.js';
import type { LLMService } from '../infra/llm/llm-service.js';
import type { RuntimeToolingContext } from '../runtime/tooling-context/index.js';

import { SessionManager } from '../app/conversation/session-manager.js';
import { InputAnalysisService } from '../app/conversation/input-analysis-service.js';
import { PersonaEngine } from '../app/conversation/persona-engine.js';
import { ResponseGenerator } from '../app/conversation/response-generator.js';
import { RetryHandler } from '../app/conversation/retry-handler.js';
import { ConversationMemoryService } from '../app/conversation/memory-service.js';
import { LocalEmbeddingService } from '../app/conversation/local-embedding-service.js';
import { CoreMemorySummaryService } from '../app/conversation/core-memory-summary-service.js';

import { SqliteSessionRepository } from '../infra/persistence/sqlite-session-repository.js';
import { SqliteMemoryRepository } from '../infra/persistence/sqlite-memory-repository.js';
import { FilePersonaRepository, InMemoryPersonaRepository } from '../infra/conversation/persona-repository.js';
import { getUserAgentsDir } from '../infra/agents/agent-discovery.js';
import { loadRuntimeConfig, type PonyBunnyRuntimeConfig } from '../infra/config/runtime-config.js';
import { ToolAllowlist, ToolEnforcer, ToolRegistry } from '../infra/tools/tool-registry.js';
import type { ConversationPort, ConversationRequest, ConversationResult } from '../runtime/conversation-boundary/index.js';
import { ConversationWorker, type ConversationWorkerInspectionSnapshot } from '../runtime/workers/conversation-worker.js';

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

interface ResolveMainAgentModelHintOptions {
  runtimeConfig?: PonyBunnyRuntimeConfig;
  agentId?: string;
  userAgentsDir?: string;
  workspaceDir?: string;
  fileExists?: (filePath: string) => boolean;
  readTextFile?: (filePath: string) => string;
}

export function resolveMainAgentModelHintFromAgentConfig(
  options: ResolveMainAgentModelHintOptions = {}
): string | undefined {
  const runtime = options.runtimeConfig ?? loadRuntimeConfig();
  const agentId = typeof options.agentId === 'string' && options.agentId.trim().length > 0
    ? options.agentId.trim()
    : runtime.agent.mainAgentId;

  const runtimeOverrideRaw = runtime.agent.modelOverrides?.[agentId];
  if (typeof runtimeOverrideRaw === 'string') {
    const runtimeOverride = runtimeOverrideRaw.trim();
    if (runtimeOverride.length > 0) {
      return runtimeOverride.toLowerCase() === 'auto' ? undefined : runtimeOverride;
    }
  }

  const userAgentsDir = options.userAgentsDir ?? getUserAgentsDir();
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const fileExists = options.fileExists ?? fs.existsSync;
  const readTextFile = options.readTextFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf-8'));

  const userAgentConfigPath = path.join(userAgentsDir, agentId, 'agent.json');
  const workspaceAgentConfigPath = path.join(workspaceDir, 'agents', agentId, 'agent.json');

  const sourcePath = fileExists(userAgentConfigPath)
    ? userAgentConfigPath
    : fileExists(workspaceAgentConfigPath)
      ? workspaceAgentConfigPath
      : null;

  if (!sourcePath) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readTextFile(sourcePath)) as {
      runner?: {
        config?: {
          model_hint?: unknown;
        };
      };
    };
    const hint = parsed.runner?.config?.model_hint;
    if (typeof hint !== 'string') {
      return undefined;
    }

    const trimmedHint = hint.trim();
    return trimmedHint.length > 0 ? trimmedHint : undefined;
  } catch {
    return undefined;
  }
}

export class SchedulerTaskBridge {
  constructor(
    private repository: IWorkOrderRepository,
    private schedulerProvider: () => SchedulerCore | null,
    private resolveModelHint: (agentId?: string) => string | undefined =
      (agentId?: string) => resolveMainAgentModelHintFromAgentConfig({ agentId })
  ) {}

  async createGoalFromConversation(
    requirements: {
      title: string;
      description: string;
      successCriteria: string[];
      constraints?: string[];
      priority?: 'low' | 'medium' | 'high';
      estimatedComplexity?: 'simple' | 'medium' | 'complex';
    },
    session: { id: string; personaId: string },
    sourceTurnId: string,
    options?: {
      sourceAgentId?: string;
    }
  ): Promise<{
    goalId: string;
    workItems: Array<{ id: string; title: string; status: string }>;
  }> {
    const selectedModel = this.resolveModelHint(options?.sourceAgentId);

    const goal = this.repository.createGoal({
      title: requirements.title,
      description: requirements.description,
      success_criteria: requirements.successCriteria.map((description) => ({
        description,
        type: 'heuristic',
        verification_method: 'manual',
        required: true,
      })),
      priority: this.mapPriority(requirements.priority),
      budget_tokens: this.estimateBudget(requirements.estimatedComplexity),
      context: {
        createdViaConversation: true,
        sessionId: session.id,
        turnId: sourceTurnId,
        personaId: session.personaId,
        ...(selectedModel ? { selected_model: selectedModel } : {}),
      },
    });

    const workItem = this.repository.createWorkItem({
      goal_id: goal.id,
      title: goal.title,
      description: goal.description,
      item_type: 'analysis',
      priority: goal.priority,
      dependencies: [],
      context: {
        ...(goal.context ?? {}),
        createdViaConversation: true,
        ...(selectedModel
          ? {
              selected_model: selectedModel,
              model: selectedModel,
            }
          : {}),
      },
    });

    const scheduler = this.schedulerProvider();
    if (scheduler) {
      await scheduler.submitGoal(goal as Goal);
    }

    return {
      goalId: goal.id,
      workItems: [
        {
          id: workItem.id,
          title: workItem.title,
          status: workItem.status,
        },
      ],
    };
  }

  subscribeToProgress(_goalId: string, _callback: (progress: {
    goalId: string;
    goalStatus: string;
    completedItems: number;
    totalItems: number;
    startedAt: number;
    currentItem?: { id: string; title: string; status: string };
  }) => void): () => void {
    return () => undefined;
  }

  async getTaskStatus(goalId: string): Promise<{
    goalId: string;
    goalStatus: string;
    completedItems: number;
    totalItems: number;
    currentItem?: { id: string; title: string; status: string };
    startedAt: number;
  } | null> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) return null;

    const workItems = this.repository.getWorkItemsByGoal(goalId);
    const completedItems = workItems.filter((item) => item.status === 'done').length;
    const currentItem = workItems.find((item) => item.status === 'in_progress');

    return {
      goalId,
      goalStatus: goal.status,
      completedItems,
      totalItems: Math.max(workItems.length, 1),
      currentItem: currentItem
        ? {
            id: currentItem.id,
            title: currentItem.title,
            status: currentItem.status,
          }
        : undefined,
      startedAt: goal.created_at,
    };
  }

  async cancelTask(goalId: string): Promise<boolean> {
    const goal = this.repository.getGoal(goalId);
    if (!goal) return false;
    if (goal.status === 'completed' || goal.status === 'cancelled') return false;

    this.repository.updateGoalStatus(goalId, 'cancelled');
    return true;
  }

  private mapPriority(priority?: 'low' | 'medium' | 'high'): number {
    if (priority === 'high') return 1;
    if (priority === 'low') return 10;
    return 5;
  }

  private estimateBudget(complexity?: 'simple' | 'medium' | 'complex'): number {
    if (complexity === 'simple') return 50_000;
    if (complexity === 'complex') return 500_000;
    return 150_000;
  }
}

export class SchedulerSessionIntake {
  private sessionManager: SessionManager;
  private personaEngine: PersonaEngine;
  private conversationPort: ConversationPort;
  private bindingsBySchedulerSession = new Map<string, SessionGatewayBinding>();

  constructor(private deps: SessionIntakeDependencies) {
    const runtimeConfig = loadRuntimeConfig();
    const personasDir = deps.personasDir ?? runtimeConfig.persona.directory;

    const personaRepository = this.buildPersonaRepository(personasDir);
    this.personaEngine = new PersonaEngine(
      personaRepository,
      runtimeConfig.persona.defaultPersonaId,
      runtimeConfig.persona.promptOverrides
    );

    const sessionRepository = new SqliteSessionRepository(deps.memoryDb);
    sessionRepository.initialize();

    const memoryRepository = new SqliteMemoryRepository(deps.memoryDb);
    memoryRepository.initialize();

    const embeddingService = new LocalEmbeddingService(runtimeConfig.memory.embeddingProvider);
    const coreSummaryService = new CoreMemorySummaryService(deps.llmService);
    const memoryService = new ConversationMemoryService(
      memoryRepository,
      embeddingService,
      5000,
      coreSummaryService
    );

    const inputAnalyzer = new InputAnalysisService(deps.llmService);

    const emptyRegistry = new ToolRegistry();
    const emptyAllowlist = new ToolAllowlist();
    const responseGenerator = new ResponseGenerator(
      deps.llmService,
      this.personaEngine,
      new ToolEnforcer(emptyRegistry, emptyAllowlist),
      deps.runtimeToolingContext
    );

    const retryHandler = new RetryHandler(deps.llmService);
    const taskBridge = new SchedulerTaskBridge(deps.repository, deps.schedulerProvider);

    this.sessionManager = new SessionManager(
      sessionRepository,
      this.personaEngine,
      inputAnalyzer,
      responseGenerator,
      taskBridge,
      retryHandler,
      memoryService,
      {
        autoSave: runtimeConfig.memory.autoSave,
        vectorWeight: runtimeConfig.memory.vectorWeight,
        keywordWeight: runtimeConfig.memory.keywordWeight,
        defaultUserProfileId: runtimeConfig.memory.userProfileId,
      }
    );

    this.conversationPort = deps.conversationPort ?? new ConversationWorker(this.sessionManager);
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

  private buildPersonaRepository(personasDir: string) {
    if (personasDir && personasDir.length > 0) {
      try {
        return new FilePersonaRepository(personasDir);
      } catch {
        return this.buildFallbackPersonaRepository();
      }
    }
    return this.buildFallbackPersonaRepository();
  }

  private buildFallbackPersonaRepository(): InMemoryPersonaRepository {
    const repository = new InMemoryPersonaRepository();
    repository.addPersona({
      id: 'pony-default',
      name: 'Pony',
      nickname: '小马',
      personality: { warmth: 0.8, formality: 0.4, humor: 0.5, empathy: 0.7 },
      communicationStyle: {
        verbosity: 'balanced',
        technicalDepth: 'adaptive',
        expressiveness: 'moderate',
      },
      expertise: {
        primaryDomains: ['software-engineering', 'devops', 'automation'],
        skillConfidence: { coding: 0.95, debugging: 0.9, architecture: 0.85 },
      },
      backstory: '我是 Pony，你的自主 AI 助手。',
      locale: 'zh-CN',
    });
    return repository;
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
