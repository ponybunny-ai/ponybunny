/**
 * IntentClassificationService Unit Tests
 *
 * Tests the LLM-based intent classification with mocked ILLMService.
 * Covers: successful classification, invalid JSON fallback, low-confidence output.
 */

import { IntentClassificationService, CLARIFICATION_THRESHOLD } from '../../../../src/app/lifecycle/intake/intent-classification-service.js';
import type { ILLMService } from '../../../../src/infra/llm/llm-service.interface.js';
import type { LLMResponse } from '../../../../src/infra/llm/llm-provider.js';
import type { Goal } from '../../../../src/work-order/types/index.js';
import { NoopLogger } from '../../../../src/infra/observability/logger.js';

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-test-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 'Add pagination to the API',
    description: 'Implement cursor-based pagination for the /users endpoint',
    success_criteria: [
      { description: 'Tests pass', type: 'deterministic', verification_method: 'npm test', required: true },
    ],
    status: 'queued',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    ...overrides,
  };
}

function makeLLMResponse(content: string): LLMResponse {
  return {
    content,
    tokensUsed: 100,
    model: 'test-model',
    finishReason: 'stop',
  };
}

function createMockLLMService(): jest.Mocked<ILLMService> {
  return {
    complete: jest.fn(),
    completeWithModel: jest.fn(),
    getProviderHealth: jest.fn().mockReturnValue([]),
  };
}

describe('IntentClassificationService', () => {
  let llmService: jest.Mocked<ILLMService>;
  let service: IntentClassificationService;

  beforeEach(() => {
    llmService = createMockLLMService();
    service = new IntentClassificationService(llmService, new NoopLogger());
  });

  describe('successful classification', () => {
    it('returns parsed GoalIntent when LLM returns valid JSON', async () => {
      const validIntent = {
        task_type: 'code_implementation',
        domain_tags: ['api', 'pagination'],
        extracted_constraints: [
          {
            description: 'Must not break existing endpoints',
            type: 'must_not_break',
            confidence: 0.9,
          },
        ],
        scope_boundary: '/users endpoint only',
        classification_confidence: 0.92,
      };

      llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify(validIntent)));

      const result = await service.classify(makeGoal());

      expect(result.task_type).toBe('code_implementation');
      expect(result.domain_tags).toEqual(['api', 'pagination']);
      expect(result.classification_confidence).toBe(0.92);
      expect(result.extracted_constraints).toHaveLength(1);
      expect(result.scope_boundary).toBe('/users endpoint only');
    });

    it('calls LLM with intent-classification workload', async () => {
      const validIntent = {
        task_type: 'analysis',
        domain_tags: ['general'],
        extracted_constraints: [],
        scope_boundary: 'full codebase',
        classification_confidence: 0.85,
      };

      llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify(validIntent)));

      await service.classify(makeGoal());

      expect(llmService.complete).toHaveBeenCalledWith(
        'intent-classification',
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ]),
        expect.objectContaining({ temperature: 0.1 }),
      );
    });

    it('includes clarification_questions when present in LLM output', async () => {
      const intentWithQuestions = {
        task_type: 'unknown',
        domain_tags: ['unclear'],
        extracted_constraints: [],
        scope_boundary: '',
        classification_confidence: 0.3,
        clarification_questions: ['What endpoint should be modified?', 'Is this a REST or GraphQL API?'],
      };

      llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify(intentWithQuestions)));

      const result = await service.classify(makeGoal());

      expect(result.clarification_questions).toEqual([
        'What endpoint should be modified?',
        'Is this a REST or GraphQL API?',
      ]);
      expect(result.classification_confidence).toBe(0.3);
    });
  });

  describe('invalid JSON fallback', () => {
    it('returns fallback intent when LLM returns non-JSON', async () => {
      llmService.complete.mockResolvedValue(makeLLMResponse('Sorry, I cannot classify this goal.'));

      const result = await service.classify(makeGoal());

      expect(result.task_type).toBe('unknown');
      expect(result.classification_confidence).toBe(0.0);
      expect(result.domain_tags).toEqual([]);
      expect(result.extracted_constraints).toEqual([]);
      expect(result.clarification_questions).toContain(
        'Could not classify goal intent. Please provide more details.',
      );
    });

    it('returns fallback intent when LLM returns JSON that fails schema validation', async () => {
      const invalidIntent = {
        task_type: 'not_a_valid_type',
        domain_tags: 'should be array',
        classification_confidence: 2.0, // out of range
      };

      llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify(invalidIntent)));

      const result = await service.classify(makeGoal());

      expect(result.task_type).toBe('unknown');
      expect(result.classification_confidence).toBe(0.0);
    });

    it('returns fallback intent when LLM returns null content', async () => {
      llmService.complete.mockResolvedValue({
        content: null,
        tokensUsed: 50,
        model: 'test-model',
        finishReason: 'stop',
      });

      const result = await service.classify(makeGoal());

      expect(result.task_type).toBe('unknown');
      expect(result.classification_confidence).toBe(0.0);
    });
  });

  describe('LLM error propagation', () => {
    it('throws when LLM service throws', async () => {
      llmService.complete.mockRejectedValue(new Error('LLM provider unavailable'));

      await expect(service.classify(makeGoal())).rejects.toThrow('LLM provider unavailable');
    });
  });

  describe('CLARIFICATION_THRESHOLD', () => {
    it('exports threshold value of 0.75', () => {
      expect(CLARIFICATION_THRESHOLD).toBe(0.75);
    });
  });
});
