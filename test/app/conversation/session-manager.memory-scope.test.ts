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

describe('SessionManager memory owner scope', () => {
  it('indexes user and agent core memory with separate owner scopes', async () => {
    const repository = new InMemorySessionRepository();

    const indexedScopes: Array<{ role: 'user' | 'assistant'; ownerType: 'agent' | 'user'; ownerId: string }> = [];
    const recalledScopeBatches: Array<Array<{ ownerType: 'agent' | 'user'; ownerId: string }>> = [];

    const memoryService = {
      indexTurn: jest.fn(async (_sessionId: string, turn: { role: 'user' | 'assistant' }, ownerScope: { ownerType: 'agent' | 'user'; ownerId: string }) => {
        indexedScopes.push({ role: turn.role, ownerType: ownerScope.ownerType, ownerId: ownerScope.ownerId });
      }),
      retrieveRelevantMemories: jest.fn(async (_sessionId: string, _query: string, options?: {
        coreOwnerScopes?: Array<{ ownerType: 'agent' | 'user'; ownerId: string }>;
      }) => {
        recalledScopeBatches.push(options?.coreOwnerScopes ?? []);
        return [];
      }),
    };

    const manager = new SessionManager(
      repository,
      {
        getDefaultPersonaId: () => 'pony-default',
        getPersona: async () => PERSONA,
        listPersonas: async () => [],
        generateSystemPrompt: () => 'system',
      },
      {
        analyze: async () => ANALYSIS,
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
      }
    );

    await manager.processMessage('hello', undefined, 'pony-default', 'user-42');

    expect(indexedScopes).toEqual(
      expect.arrayContaining([
        { role: 'user', ownerType: 'user', ownerId: 'user-42' },
        { role: 'assistant', ownerType: 'agent', ownerId: 'pony-default' },
      ])
    );

    expect(recalledScopeBatches[0]).toEqual(
      expect.arrayContaining([
        { ownerType: 'agent', ownerId: 'pony-default' },
        { ownerType: 'user', ownerId: 'user-42' },
      ])
    );
  });
});
