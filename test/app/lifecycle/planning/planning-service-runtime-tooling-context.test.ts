import { jest } from '@jest/globals';

const getLegacyCompatiblePromptProviderMock = jest.fn(() => ({
  generatePlanningPrompt: () => 'global prompt',
}));

jest.mock('../../../../src/infra/prompts/legacy-prompt-tooling-compatibility.js', () => ({
  getLegacyCompatiblePromptProvider: getLegacyCompatiblePromptProviderMock,
}));

jest.mock('../../../../src/infra/prompts/prompt-provider.js', () => ({
  PromptProvider: class MockPromptProvider {
    generatePlanningPrompt() {
      return 'global prompt';
    }
  },
}));

import { PlanningService } from '../../../../src/app/lifecycle/planning/planning-service.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { ILLMProvider } from '../../../../src/infra/llm/llm-provider.js';
import type { Goal } from '../../../../src/work-order/types/index.js';
import type { RuntimeToolingContext } from '../../../../src/runtime/tooling-context/index.js';

describe('PlanningService runtime tooling context', () => {
  beforeEach(() => {
    getLegacyCompatiblePromptProviderMock.mockClear();
  });

  it('uses the explicit tooling context prompt provider instead of the compatibility fallback', async () => {
    const repository = {
      getReadyWorkItems: jest.fn(() => []),
      createWorkItem: jest.fn(),
    } as unknown as IWorkOrderRepository;

    const llmProvider = {
      complete: jest.fn(async () => ({
        content: '[]',
        tokensUsed: 1,
        finishReason: 'stop',
      })),
    } as unknown as ILLMProvider;

    const runtimeToolingContext = {
      getPromptProvider: () => ({
        generatePlanningPrompt: () => 'runtime prompt',
      }),
    } as unknown as RuntimeToolingContext;

    const service = new PlanningService(
      repository,
      llmProvider,
      undefined,
      runtimeToolingContext
    );

    const goal: Goal = {
      id: 'goal-1',
      title: 'Goal',
      description: 'Desc',
      status: 'queued',
      created_at: Date.now(),
      updated_at: Date.now(),
      spent_tokens: 0,
      spent_time_minutes: 0,
      spent_cost_usd: 0,
      success_criteria: [],
      priority: 1,
    };

    await service.planWorkItems(goal);

    expect(llmProvider.complete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: 'runtime prompt',
        }),
      ]),
      expect.any(Object)
    );
    expect(getLegacyCompatiblePromptProviderMock).not.toHaveBeenCalled();
  });
});
