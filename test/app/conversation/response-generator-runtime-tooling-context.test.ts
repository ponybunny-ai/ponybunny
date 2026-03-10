import { jest } from '@jest/globals';

jest.mock('../../../src/infra/tools/tool-provider.js', () => ({
  getGlobalToolProvider: () => ({
    getToolDefinitions: () => [
      {
        name: 'global_only_tool',
        description: 'Should not be used',
        parameters: { type: 'object', properties: {} },
      },
    ],
  }),
}));

import { ResponseGenerator } from '../../../src/app/conversation/response-generator.js';
import type { RuntimeToolingContext } from '../../../src/runtime/tooling-context/index.js';

describe('ResponseGenerator runtime tooling context', () => {
  it('uses the explicit tooling context tool provider instead of the global singleton', async () => {
    const llmService = {
      completeForWorkload: jest.fn(async () => ({ content: 'response' })),
    };
    const personaEngine = {
      generateSystemPrompt: jest.fn(() => 'system'),
    };

    const runtimeToolingContext = {
      toolProvider: {
        getToolDefinitions: () => [
          {
            name: 'web_search',
            description: 'Search',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    } as RuntimeToolingContext;

    const generator = new ResponseGenerator(
      llmService as never,
      personaEngine as never,
      undefined,
      runtimeToolingContext
    );

    await generator.generate({
      persona: {
        id: 'default',
        name: 'Default',
        personality: {
          warmth: 0.5,
          formality: 0.5,
          humor: 0.2,
          empathy: 0.5,
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
      },
      analysis: {
        rawInput: 'search for docs',
        intent: { primary: 'question', confidence: 0.9, entities: [] },
        emotion: { primary: 'neutral', intensity: 0.1, urgency: 'low' },
        purpose: { isActionable: false, missingInfo: [] },
        analyzedAt: Date.now(),
      },
      conversationState: 'chatting',
      recentTurns: [],
    });

    expect(llmService.completeForWorkload).toHaveBeenCalledWith(
      'conversation',
      expect.any(Array),
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'web_search',
          }),
        ],
      })
    );
  });
});
