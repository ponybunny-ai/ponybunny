import type Database from 'better-sqlite3';

import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';
import type { LLMService } from '../../infra/llm/llm-service.js';
import type { RuntimeToolingContext } from '../../runtime/tooling-context/index.js';
import { SessionManager } from '../../app/conversation/session-manager.js';
import { InputAnalysisService } from '../../app/conversation/input-analysis-service.js';
import { PersonaEngine } from '../../app/conversation/persona-engine.js';
import { ResponseGenerator } from '../../app/conversation/response-generator.js';
import { RetryHandler } from '../../app/conversation/retry-handler.js';
import { ConversationMemoryService } from '../../app/conversation/memory-service.js';
import { LocalEmbeddingService } from '../../app/conversation/local-embedding-service.js';
import { CoreMemorySummaryService } from '../../app/conversation/core-memory-summary-service.js';
import { SqliteSessionRepository } from '../../infra/persistence/sqlite-session-repository.js';
import { SqliteMemoryRepository } from '../../infra/persistence/sqlite-memory-repository.js';
import { FilePersonaRepository, InMemoryPersonaRepository } from '../../infra/conversation/persona-repository.js';
import { loadRuntimeConfig } from '../../infra/config/runtime-config.js';
import { ToolAllowlist, ToolEnforcer, ToolRegistry } from '../../infra/tools/tool-registry.js';
import type { ConversationPort } from '../../runtime/conversation-boundary/index.js';
import { ConversationWorker } from '../../runtime/workers/conversation-worker.js';
import type { SchedulerCore } from '../../scheduler/core/index.js';
import { SchedulerTaskBridge } from './scheduler-task-bridge.js';
import { ConversationTaskMaterializer } from './conversation-task-materializer.js';
import { getGlobalAgentDefinitionReadAccess } from '../../infra/agents/agent-definition-read-access.js';

export interface DefaultConversationBootstrapDependencies {
  repository: IWorkOrderRepository;
  memoryDb: Database.Database;
  llmService: LLMService;
  runtimeToolingContext: RuntimeToolingContext;
  personasDir?: string;
  schedulerProvider: () => SchedulerCore | null;
  conversationPort?: ConversationPort;
}

export interface DefaultConversationBootstrap {
  sessionManager: SessionManager;
  conversationPort: ConversationPort;
}

export function createDefaultConversationBootstrap(
  deps: DefaultConversationBootstrapDependencies
): DefaultConversationBootstrap {
  const runtimeConfig = loadRuntimeConfig();
  const personasDir = deps.personasDir ?? runtimeConfig.persona.directory;

  const personaRepository = buildPersonaRepository(personasDir);
  const personaEngine = new PersonaEngine(
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
  const responseGenerator = new ResponseGenerator(
    deps.llmService,
    personaEngine,
    createConversationResponseToolEnforcer(),
    deps.runtimeToolingContext
  );
  const retryHandler = new RetryHandler(deps.llmService);
  const taskMaterializer = new ConversationTaskMaterializer(
    deps.repository,
    deps.schedulerProvider
  );
  const taskBridge = new SchedulerTaskBridge(deps.repository, taskMaterializer);

  const sessionManager = new SessionManager(
    sessionRepository,
    personaEngine,
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
    },
    getGlobalAgentDefinitionReadAccess()
  );

  return {
    sessionManager,
    conversationPort: deps.conversationPort ?? new ConversationWorker(sessionManager),
  };
}

function buildPersonaRepository(personasDir: string) {
  if (personasDir && personasDir.length > 0) {
    try {
      return new FilePersonaRepository(personasDir);
    } catch {
      return buildFallbackPersonaRepository();
    }
  }

  return buildFallbackPersonaRepository();
}

function buildFallbackPersonaRepository(): InMemoryPersonaRepository {
  const repository = new InMemoryPersonaRepository();
  repository.addPersona({
    id: 'pony-default',
    name: 'Pony',
    nickname: 'Pony',
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
    backstory: 'Pony is a highly educated, emotionally intelligent, and exceptionally capable executive assistant. Calm, discreet, and polished, Pony helps users clarify priorities, organize complex information, coordinate moving parts, and turn ambiguous requests into clear next steps. Pony combines strong judgment, excellent communication, and practical follow-through, aiming to be proactive without being intrusive, warm without being overly familiar, and precise without sounding rigid.',
    locale: 'en-GB',
  });
  return repository;
}

function createConversationResponseToolEnforcer(): ToolEnforcer {
  return new ToolEnforcer(new ToolRegistry(), new ToolAllowlist());
}
