const loadRuntimeConfigMock = jest.fn();
const getAgentDefinitionViewMock = jest.fn();

jest.mock('../../../src/infra/config/runtime-config.js', () => ({
  loadRuntimeConfig: loadRuntimeConfigMock,
}));

import { SessionManager } from '../../../src/app/conversation/session-manager.js';
import { InMemorySessionRepository } from '../../../src/infra/conversation/session-repository.js';
import type { IInputAnalysis } from '../../../src/domain/conversation/analysis.js';
import type { IPersona } from '../../../src/domain/conversation/persona.js';

const PERSONA: IPersona = {
  id: 'pony-default',
  name: 'Pony',
  personality: { warmth: 0.7, formality: 0.4, humor: 0.5, empathy: 0.7 },
  communicationStyle: { verbosity: 'balanced', technicalDepth: 'adaptive', expressiveness: 'moderate' },
  expertise: { primaryDomains: ['software'], skillConfidence: { coding: 0.9 } },
  locale: 'en-US',
};

const ANALYSIS: IInputAnalysis = {
  intent: { primary: 'question', confidence: 0.8, entities: [] },
  emotion: { primary: 'neutral', intensity: 0.5, urgency: 'medium' },
  purpose: { isActionable: false, missingInfo: [] },
  rawInput: 'hello',
  analyzedAt: Date.now(),
};

function buildRuntimeConfig(modelOverrides: Record<string, string> = {}) {
  return {
    paths: {
      database: '/tmp/pony.db',
      schedulerSocket: '/tmp/pony.sock',
    },
    gateway: {
      host: '127.0.0.1',
      port: 8080,
    },
    scheduler: {
      tickIntervalMs: 1000,
      maxConcurrentGoals: 5,
      agentsEnabled: true,
      executionMode: 'direct' as const,
      deterministicRuntimeEnabled: false,
      planCompilerEnabled: false,
      toolRoutingMode: 'legacy' as const,
      allowModelNativeTools: false,
      eventedOrphanTimeoutMs: 30000,
      runtimeRollout: {
        shadowModeEnabled: false,
        canaryPercent: 0,
        rollbackOnFailure: true,
        lanePercents: {
          dryRun: 0,
          compile: 0,
          replay: 0,
        },
      },
      runEventRetention: {
        enabled: true,
        intervalMs: 60000,
        maxAgeMs: 60000,
        keepLatestPerRun: 10,
      },
    },
    agent: {
      mainAgentId: 'lead',
      personaEnabled: false,
      modelOverrides,
    },
    persona: {
      directory: '/tmp/personas',
      defaultPersonaId: 'pony-default',
      promptOverrides: {
        personalityDescription: '',
        communicationStyleDescription: '',
        expertiseDescription: '',
        guidelines: '',
        backstory: '',
      },
    },
    debug: {
      serverPort: 3001,
      loggingEnabled: false,
      antigravityDebug: false,
    },
    memory: {
      backend: 'memory' as const,
      database: '/tmp/memory.db',
      userProfileId: 'local-default-user',
      autoSave: true,
      embeddingProvider: 'none',
      vectorWeight: 0.7,
      keywordWeight: 0.3,
    },
    tui: {
      inputBackgroundColor: 'black' as const,
      sessionFirstEnabled: true,
      goalSubmitFastPathEnabled: false,
    },
  };
}

function createManager(options?: {
  memoryService?: {
    indexTurn: jest.Mock;
    retrieveRelevantMemories: jest.Mock;
  };
  analyze?: jest.Mock;
}) {
  const repository = new InMemorySessionRepository();
  const analyze = options?.analyze ?? jest.fn(async () => ANALYSIS);
  const memoryService = options?.memoryService;

  return {
    manager: new SessionManager(
      repository,
      {
        getDefaultPersonaId: () => 'pony-default',
        getPersona: async () => PERSONA,
        listPersonas: async () => [],
        generateSystemPrompt: () => 'system',
      },
      {
        analyze,
      },
      {
        generate: async () => 'response',
        generateProgressNarration: async () => 'progress',
        generateResultSummary: async () => 'summary',
      },
      {
        createGoalFromConversation: async () => ({ goalId: 'g1', workItems: [] }),
        subscribeToProgress: () => () => {},
        getTaskStatus: async () => null,
        cancelTask: async () => true,
      },
      {
        analyzeFailure: async () => ({
          errorType: 'unknown',
          errorMessage: '',
          suggestedStrategies: ['human_guidance'],
          canAutoRetry: false,
          requiresUserInput: true,
        }),
        selectRetryStrategy: () => null,
        canAutoRetry: () => false,
      },
      memoryService,
      {
        autoSave: true,
        vectorWeight: 0.7,
        keywordWeight: 0.3,
        defaultUserProfileId: 'local-default-user',
      },
      {
        getAgentDefinitionView: getAgentDefinitionViewMock,
      }
    ),
    analyze,
    repository,
  };
}

describe('SessionManager preferred model alignment', () => {
  beforeEach(() => {
    loadRuntimeConfigMock.mockReset();
    getAgentDefinitionViewMock.mockReset();
    loadRuntimeConfigMock.mockReturnValue(buildRuntimeConfig());
    getAgentDefinitionViewMock.mockReturnValue(undefined);
  });

  it('prefers the runtime override over the agent runner hint for session-level consumers', async () => {
    loadRuntimeConfigMock.mockReturnValue(buildRuntimeConfig({ reviewer: 'openai.gpt-5.3' }));
    getAgentDefinitionViewMock.mockReturnValue({
      runnerModelHint: 'anthropic.claude-3-7-sonnet',
    });

    const memoryService = {
      indexTurn: jest.fn(async () => undefined),
      retrieveRelevantMemories: jest.fn(async () => []),
    };
    const { manager, analyze } = createManager({ memoryService });

    await manager.processMessage('Summarize the current task', undefined, 'pony-default', 'user-1', undefined, 'reviewer');

    expect(analyze).toHaveBeenCalledWith(
      'Summarize the current task',
      expect.any(Array),
      'openai.gpt-5.3'
    );
    expect(memoryService.indexTurn).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ role: 'user' }),
      expect.any(Object),
      'openai.gpt-5.3'
    );
    expect(memoryService.indexTurn).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ role: 'assistant' }),
      expect.any(Object),
      'openai.gpt-5.3'
    );
  });

  it('falls back to the agent runner hint when no runtime override exists', async () => {
    getAgentDefinitionViewMock.mockReturnValue({
      runnerModelHint: 'openai.o4-mini',
    });

    const { manager, analyze } = createManager();
    await manager.processMessage('Check the latest notes', undefined, 'pony-default', 'user-2', undefined, 'reviewer');

    expect(analyze).toHaveBeenCalledWith(
      'Check the latest notes',
      expect.any(Array),
      'openai.o4-mini'
    );
  });

  it('keeps the preferred model undefined when neither override nor agent hint is present', async () => {
    const { manager, analyze } = createManager();

    const response = await manager.processMessage('Hello there');

    expect(analyze).toHaveBeenCalledWith(
      'Hello there',
      expect.any(Array),
      undefined
    );
    expect(response).toEqual(
      expect.objectContaining({
        sessionId: expect.any(String),
        response: 'response',
        decision: 'response_only',
      })
    );
  });
});
