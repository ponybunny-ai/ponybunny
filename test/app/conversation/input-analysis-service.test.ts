import { InputAnalysisService } from '../../../src/app/conversation/input-analysis-service.js';

describe('InputAnalysisService', () => {
  it('uses conversation workload and forwards preferred model override', async () => {
    const llmService = {
      completeForWorkload: jest.fn(async () => ({
        content: JSON.stringify({
          intent: {
            primary: 'task_request',
            confidence: 0.9,
            entities: [],
          },
          emotion: {
            primary: 'neutral',
            intensity: 0.4,
            urgency: 'medium',
          },
          purpose: {
            isActionable: true,
            extractedGoal: 'Build feature',
            missingInfo: [],
            successCriteria: ['done'],
            constraints: [],
          },
        }),
      })),
    };

    const service = new InputAnalysisService(llmService as never);
    const result = await service.analyze('Please build this', [], 'openai.gpt-5.3');

    expect(result.purpose.isActionable).toBe(true);
    expect(llmService.completeForWorkload).toHaveBeenCalledWith(
      'conversation',
      expect.any(Array),
      expect.objectContaining({
        maxTokens: 1000,
        model: 'openai.gpt-5.3',
      })
    );
  });
});
