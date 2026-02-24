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

function createManager(repository: InMemorySessionRepository): SessionManager {
  return new SessionManager(
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
    }
  );
}

describe('SessionManager lifecycle management', () => {
  it('creates session with user profile metadata for human interactive flows', () => {
    const repository = new InMemorySessionRepository();
    const manager = createManager(repository);

    const session = manager.createSession('pony-default', 'user-abc');
    expect(session.metadata?.userProfileId).toBe('user-abc');
    expect(session.lifecycleState).toBe('active');
  });

  it('archives and resumes sessions without using job identifiers', async () => {
    const repository = new InMemorySessionRepository();
    const manager = createManager(repository);

    const session = manager.createSession('pony-default', 'user-xyz');
    await manager.processMessage('First user message', session.id, 'pony-default', 'user-xyz');

    const archived = manager.archiveSession(session.id);
    expect(archived.success).toBe(true);
    expect(archived.snapshot?.summary.length).toBeGreaterThan(0);

    const archivedSession = manager.getSession(session.id);
    expect(archivedSession?.lifecycleState).toBe('archived');

    const resumed = manager.resumeSession(session.id);
    expect(resumed).toBe(true);
    const resumedSession = manager.getSession(session.id);
    expect(resumedSession?.lifecycleState).toBe('active');
  });
});
