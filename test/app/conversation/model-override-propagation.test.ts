import { ResponseGenerator } from '../../../src/app/conversation/response-generator.js';
import { RetryHandler } from '../../../src/app/conversation/retry-handler.js';
import { CoreMemorySummaryService } from '../../../src/app/conversation/core-memory-summary-service.js';
import type { IPersona } from '../../../src/domain/conversation/persona.js';

describe('Conversation model override propagation', () => {
  it('forwards preferred model in progress narration generation', async () => {
    const llmService = {
      completeForWorkload: jest.fn(async () => ({ content: 'ok' })),
    };
    const personaEngine = {
      generateSystemPrompt: jest.fn(() => 'system'),
    };

    const generator = new ResponseGenerator(llmService as never, personaEngine as never);
    const persona: IPersona = {
      id: 'default',
      name: 'Default',
      personality: {
        warmth: 0.5,
        formality: 0.5,
        humor: 0.2,
        empathy: 0.6,
      },
      communicationStyle: {
        verbosity: 'balanced',
        technicalDepth: 'adaptive',
        expressiveness: 'moderate',
      },
      expertise: {
        primaryDomains: ['general'],
        skillConfidence: {},
      },
      locale: 'en-US',
    };

    await generator.generateProgressNarration(
      {
        goalId: 'goal-1',
        completedSteps: 1,
        totalSteps: 2,
        currentStep: 'Doing work',
        elapsedTime: 1000,
      },
      persona,
      'cpa.deepseek-v3.1'
    );

    expect(llmService.completeForWorkload).toHaveBeenCalledWith(
      'conversation',
      expect.any(Array),
      expect.objectContaining({
        maxTokens: 200,
        model: 'cpa.deepseek-v3.1',
      })
    );
  });

  it('forwards preferred model in retry failure analysis', async () => {
    const llmService = {
      completeForWorkload: jest.fn(async () => ({
        content: JSON.stringify({
          errorType: 'transient',
          suggestedStrategies: ['same_approach'],
          canAutoRetry: true,
          requiresUserInput: false,
          reasoning: 'temporary error',
        }),
      })),
    };

    const handler = new RetryHandler(llmService as never);
    await handler.analyzeFailure(
      'timeout',
      {
        attemptNumber: 1,
        maxAttempts: 3,
        previousStrategies: [],
        failureHistory: [],
      },
      'cpa.deepseek-v3.1'
    );

    expect(llmService.completeForWorkload).toHaveBeenCalledWith(
      'conversation',
      expect.any(Array),
      expect.objectContaining({
        maxTokens: 500,
        model: 'cpa.deepseek-v3.1',
      })
    );
  });

  it('forwards preferred model in core memory summarization', async () => {
    const llmService = {
      completeForWorkload: jest.fn(async () => ({
        content: '{"summary":"Important decision","importance":0.9}',
      })),
    };

    const service = new CoreMemorySummaryService(llmService as never);
    const result = await service.summarize({
      sessionId: 'session-1',
      role: 'user',
      content: 'Use CPA model for this session',
      ownerScope: { ownerType: 'user', ownerId: 'u1' },
      preferredModel: 'cpa.deepseek-v3.1',
    });

    expect(result.summary).toContain('Important decision');
    expect(llmService.completeForWorkload).toHaveBeenCalledWith(
      'conversation',
      expect.any(Array),
      expect.objectContaining({
        maxTokens: 220,
        model: 'cpa.deepseek-v3.1',
      })
    );
  });
});
