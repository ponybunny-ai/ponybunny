/**
 * FeatureExtractionService Unit Tests — Sub-phase 3 (GAP D1)
 *
 * Tests LLM-based knowledge extraction with mocked dependencies.
 * Verifies: successful extraction, invalid JSON handling, missing ContextPack,
 * confidence filtering, and knowledge_type validation.
 */

import { FeatureExtractionService } from '../../../../src/app/lifecycle/evaluation/feature-extraction-service.js';
import type { ILLMService } from '../../../../src/infra/llm/llm-service.interface.js';
import type { GlobalKnowledgeService } from '../../../../src/domain/knowledge/global-knowledge-service.js';
import type { IWorkOrderRepository } from '../../../../src/infra/persistence/repository-interface.js';
import type { GoalEvaluationReport } from '../../../../src/harness/post-goal-evaluator.js';
import type { Goal, ContextPack, ContextSnapshot } from '../../../../src/work-order/types/index.js';
import type { ILogger } from '../../../../src/infra/observability/logger.js';
import type { LLMResponse } from '../../../../src/infra/llm/llm-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 'Test Goal',
    description: 'A test goal',
    success_criteria: [],
    status: 'completed',
    priority: 1,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    context: {
      intent: {
        task_type: 'code_implementation',
        domain_tags: ['typescript', 'testing'],
        extracted_constraints: [],
        scope_boundary: 'src/app/',
        classification_confidence: 0.9,
      },
    },
    ...overrides,
  };
}

function makeReport(overrides: Partial<GoalEvaluationReport> = {}): GoalEvaluationReport {
  return {
    goalId: 'goal-1',
    timestamp: Date.now(),
    trigger: 'goal_completed',
    workItemResults: [
      {
        workItemId: 'wi-1',
        runId: 'run-1',
        evaluation: {
          decision: 'publish',
          reasoning: 'All tests passed',
          confidence: 0.9,
        } as any,
        skipped: false,
      },
    ],
    summary: {
      total: 1,
      publish: 1,
      retry: 0,
      replan: 0,
      escalate: 0,
      skipped: 0,
    },
    unactionableDecisions: [],
    ...overrides,
  };
}

function makeSnapshot(): ContextSnapshot {
  return {
    goal_state: {
      current_work_items: [],
      completed_work_items: ['wi-1'],
      blocked_work_items: [],
      recent_decisions: [],
      active_escalations: [],
    },
    execution_summary: {
      total_runs: 3,
      success_count: 2,
      failure_count: 1,
      most_common_errors: [{ signature: 'TIMEOUT', count: 1 }],
    },
    knowledge_base: {
      learned_patterns: [],
      pitfalls_discovered: ['Flaky test on CI'],
      successful_approaches: [],
    },
    next_actions: {
      recommended_work_items: [],
      risk_factors: [],
    },
  };
}

function makeContextPack(goalId: string = 'goal-1'): ContextPack {
  return {
    id: 'cp-1',
    created_at: Date.now(),
    goal_id: goalId,
    pack_type: 'daily_checkpoint',
    snapshot_data: makeSnapshot(),
    compressed: false,
    size_bytes: 100,
  };
}

function makeLLMResponse(content: string): LLMResponse {
  return {
    content,
    tokensUsed: 500,
    model: 'test-model',
    finishReason: 'stop',
  };
}

function createMockLogger(): jest.Mocked<ILogger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as any;
}

function createMockLLMService(): jest.Mocked<Pick<ILLMService, 'complete'>> {
  return {
    complete: jest.fn(),
  };
}

function createMockKnowledgeService(): jest.Mocked<Pick<GlobalKnowledgeService, 'record'>> {
  return {
    record: jest.fn().mockReturnValue({
      id: 'k-1',
      created_at: Date.now(),
      source_goal_id: 'goal-1',
      source_context_pack_id: null,
      knowledge_type: 'pitfall',
      domain_tags: [],
      scope: null,
      content: 'test',
      confidence: 0.8,
      occurrence_count: 1,
      last_reinforced_at: Date.now(),
      decayed_at: null,
    }),
  };
}

function createMockRepository(): jest.Mocked<Pick<IWorkOrderRepository, 'getLatestContextPack'>> {
  return {
    getLatestContextPack: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeatureExtractionService', () => {
  let service: FeatureExtractionService;
  let llmService: ReturnType<typeof createMockLLMService>;
  let knowledgeService: ReturnType<typeof createMockKnowledgeService>;
  let repository: ReturnType<typeof createMockRepository>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    llmService = createMockLLMService();
    knowledgeService = createMockKnowledgeService();
    repository = createMockRepository();
    logger = createMockLogger();

    service = new FeatureExtractionService(
      llmService as any,
      knowledgeService as any,
      repository as any,
      logger,
    );
  });

  it('should extract and record valid knowledge entries', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'pitfall', content: 'Flaky tests require retry logic', confidence: 0.8 },
      { knowledge_type: 'pattern', content: 'Always run lint before tests', confidence: 0.7 },
    ])));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(2);
    expect(knowledgeService.record).toHaveBeenCalledTimes(2);
    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      knowledge_type: 'pitfall',
      content: 'Flaky tests require retry logic',
      confidence: 0.8,
      source_goal_id: 'goal-1',
      domain_tags: ['typescript', 'testing'],
    }));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'feature_extraction_complete', entriesWritten: 2 }),
      expect.any(String),
    );
  });

  it('should handle LLM returning JSON wrapped in markdown fences', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(
      '```json\n[{"knowledge_type":"approach","content":"Use incremental builds","confidence":0.9}]\n```'
    ));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(1);
    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      knowledge_type: 'approach',
      content: 'Use incremental builds',
    }));
  });

  it('should return 0 when no ContextPack exists', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(undefined);

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(0);
    expect(llmService.complete).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('should return 0 when LLM returns invalid JSON', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse('This is not JSON at all'));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(0);
    expect(knowledgeService.record).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1' }),
      expect.stringContaining('invalid JSON'),
    );
  });

  it('should return 0 when LLM returns non-array JSON', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse('{"not": "an array"}'));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(0);
    expect(knowledgeService.record).not.toHaveBeenCalled();
  });

  it('should return 0 when LLM call throws', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockRejectedValue(new Error('LLM unavailable'));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1' }),
      expect.stringContaining('LLM call failed'),
    );
  });

  it('should filter out entries with confidence < 0.5', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'pitfall', content: 'Low confidence insight', confidence: 0.3 },
      { knowledge_type: 'pitfall', content: 'High confidence insight', confidence: 0.8 },
    ])));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(1);
    expect(knowledgeService.record).toHaveBeenCalledTimes(1);
    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      content: 'High confidence insight',
    }));
  });

  it('should filter out entries with invalid knowledge_type', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'invalid_type', content: 'Should be skipped', confidence: 0.9 },
      { knowledge_type: 'constraint', content: 'Valid constraint', confidence: 0.9 },
    ])));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(1);
    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      knowledge_type: 'constraint',
      content: 'Valid constraint',
    }));
  });

  it('should filter out entries with content exceeding 500 characters', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    const longContent = 'x'.repeat(501);
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'pitfall', content: longContent, confidence: 0.9 },
      { knowledge_type: 'pitfall', content: 'Short content', confidence: 0.9 },
    ])));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(1);
    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Short content',
    }));
  });

  it('should use scope from GoalIntent when entry has no scope', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'pitfall', content: 'Some pitfall', confidence: 0.8 },
    ])));

    await service.extractAndRecord(report, goal);

    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'src/app/',
    }));
  });

  it('should use entry scope when provided instead of GoalIntent scope', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'pitfall', content: 'Scoped pitfall', confidence: 0.8, scope: 'src/infra/' },
    ])));

    await service.extractAndRecord(report, goal);

    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'src/infra/',
    }));
  });

  it('should handle LLM returning empty array gracefully', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse('[]'));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(0);
    expect(knowledgeService.record).not.toHaveBeenCalled();
    // No info log since recorded === 0
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should cap entries at 10 even if LLM returns more', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    const entries = Array.from({ length: 15 }, (_, i) => ({
      knowledge_type: 'pitfall',
      content: `Entry ${i}`,
      confidence: 0.9,
    }));
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify(entries)));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(10);
    expect(knowledgeService.record).toHaveBeenCalledTimes(10);
  });

  it('should handle goal without intent context', async () => {
    const goal = makeGoal({ context: undefined });
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'pattern', content: 'Some pattern', confidence: 0.7 },
    ])));

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(1);
    expect(knowledgeService.record).toHaveBeenCalledWith(expect.objectContaining({
      domain_tags: [],
      scope: undefined,
    }));
  });

  it('should continue recording other entries when one record() call throws', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue(makeLLMResponse(JSON.stringify([
      { knowledge_type: 'pitfall', content: 'Will fail to record', confidence: 0.8 },
      { knowledge_type: 'pattern', content: 'Will succeed', confidence: 0.9 },
    ])));

    knowledgeService.record
      .mockImplementationOnce(() => { throw new Error('DB error'); })
      .mockReturnValueOnce({} as any);

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(1);
    expect(knowledgeService.record).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1' }),
      expect.stringContaining('Failed to record'),
    );
  });

  it('should handle LLM returning null content', async () => {
    const goal = makeGoal();
    const report = makeReport();

    repository.getLatestContextPack.mockReturnValue(makeContextPack());
    llmService.complete.mockResolvedValue({
      content: null,
      tokensUsed: 0,
      model: 'test',
      finishReason: 'stop',
    });

    const recorded = await service.extractAndRecord(report, goal);

    expect(recorded).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});
