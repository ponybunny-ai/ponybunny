import { ModelSelector } from '../../../src/scheduler/model-selector/model-selector.js';
import { DEFAULT_MODEL_TIER_CONFIG } from '../../../src/scheduler/model-selector/model-tier-config.js';
import type { WorkItem, Goal } from '../../../src/work-order/types/index.js';
import type { IComplexityScorer, ComplexityScore, ModelTierConfig } from '../../../src/scheduler/model-selector/types.js';

describe('ModelSelector', () => {
  const createWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
    id: 'wi-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    goal_id: 'goal-1',
    title: 'Test Work Item',
    description: 'A test description',
    item_type: 'code',
    status: 'ready',
    priority: 50,
    dependencies: [],
    blocks: [],
    estimated_effort: 'M',
    retry_count: 0,
    max_retries: 3,
    verification_status: 'not_started',
    ...overrides,
  });

  const createGoal = (overrides: Partial<Goal> = {}): Goal => ({
    id: 'goal-1',
    created_at: Date.now(),
    updated_at: Date.now(),
    title: 'Test Goal',
    description: 'A test goal description',
    success_criteria: [],
    status: 'queued',
    priority: 50,
    spent_tokens: 0,
    spent_time_minutes: 0,
    spent_cost_usd: 0,
    ...overrides,
  });

  describe('selectModel', () => {
    test('should select simple model for low complexity work items', () => {
      const selector = new ModelSelector();
      const workItem = createWorkItem({
        item_type: 'doc',
        estimated_effort: 'S',
        dependencies: [],
        description: 'Short',
        priority: 10,
        retry_count: 0,
      });

      const result = selector.selectModel(workItem);

      expect(result.tier).toBe('simple');
      expect(result.model).toBe('claude-haiku-4-5-20251001');
    });

    test('should select medium model for medium complexity work items', () => {
      const selector = new ModelSelector();
      const workItem = createWorkItem({
        item_type: 'code',
        estimated_effort: 'M',
        dependencies: ['dep-1'],
        description: 'A medium length description for context',
        priority: 50,
        retry_count: 0,
      });

      const result = selector.selectModel(workItem);

      expect(result.tier).toBe('medium');
      expect(result.model).toBe('claude-sonnet-4-5-20250929');
    });

    test('should select complex model for high complexity work items', () => {
      const selector = new ModelSelector();
      const workItem = createWorkItem({
        item_type: 'analysis',
        estimated_effort: 'XL',
        dependencies: ['a', 'b', 'c', 'd', 'e'],
        description: 'A'.repeat(1200),
        priority: 90,
        retry_count: 2,
      });

      const result = selector.selectModel(workItem);

      expect(result.tier).toBe('complex');
      expect(result.model).toBe('claude-opus-4-5-20251101');
    });

    test('should include reasoning in result', () => {
      const selector = new ModelSelector();
      const workItem = createWorkItem({ title: 'My Task' });

      const result = selector.selectModel(workItem);

      expect(result.reasoning).toContain('My Task');
      expect(result.reasoning).toContain('scored');
      expect(result.reasoning).toContain('tier');
    });

    test('should pick first available model when primary is unavailable', () => {
      const isModelAvailable = (model: string): boolean => model === 'gpt-5.2';
      const selector = new ModelSelector(undefined, undefined, isModelAvailable);
      const workItem = createWorkItem({
        item_type: 'code',
        estimated_effort: 'M',
        dependencies: ['dep-1'],
        description: 'A medium complexity task',
        priority: 50,
      });

      const result = selector.selectModel(workItem);

      expect(result.model).toBe('gpt-5.2');
    });

    test('should fall back to any globally available model when tier chain has no available models', () => {
      const isModelAvailable = (model: string): boolean => model === 'gpt-5.2-codex';
      const selector = new ModelSelector(undefined, undefined, isModelAvailable);
      const workItem = createWorkItem({
        item_type: 'analysis',
        estimated_effort: 'XL',
        dependencies: ['a', 'b', 'c'],
        description: 'A'.repeat(1200),
        priority: 90,
      });

      const result = selector.selectModel(workItem);

      expect(result.model).toBe('gpt-5.2-codex');
    });
  });

  describe('selectModelForPlanning', () => {
    test('should select simple model for simple goals', () => {
      const selector = new ModelSelector();
      const goal = createGoal({
        description: 'Short goal',
        success_criteria: [],
        priority: 20,
        budget_tokens: 5000,
      });

      const result = selector.selectModelForPlanning(goal);

      expect(result.tier).toBe('simple');
      expect(result.model).toBe('claude-haiku-4-5-20251001');
    });

    test('should select complex model for complex goals', () => {
      const selector = new ModelSelector();
      const goal = createGoal({
        description: 'A'.repeat(1500),
        success_criteria: [
          { description: 'c1', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c2', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c3', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c4', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c5', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c6', type: 'deterministic', verification_method: 'test', required: true },
        ],
        priority: 95,
        budget_tokens: 200000,
      });

      const result = selector.selectModelForPlanning(goal);

      expect(result.tier).toBe('complex');
      expect(result.model).toBe('claude-opus-4-5-20251101');
    });

    test('should consider success_criteria count', () => {
      const selector = new ModelSelector();

      const simpleGoal = createGoal({ success_criteria: [] });
      const complexGoal = createGoal({
        success_criteria: [
          { description: 'c1', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c2', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c3', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c4', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c5', type: 'deterministic', verification_method: 'test', required: true },
          { description: 'c6', type: 'deterministic', verification_method: 'test', required: true },
        ],
      });

      const simpleResult = selector.selectModelForPlanning(simpleGoal);
      const complexResult = selector.selectModelForPlanning(complexGoal);

      expect(complexResult.complexityScore.score).toBeGreaterThan(simpleResult.complexityScore.score);
    });
  });

  describe('custom configuration', () => {
    test('should use custom model config', () => {
      const customConfig: ModelTierConfig = {
        simple: { primary: 'custom-simple' },
        medium: { primary: 'custom-medium' },
        complex: { primary: 'custom-complex' },
      };

      const selector = new ModelSelector(customConfig);
      const workItem = createWorkItem({
        item_type: 'doc',
        estimated_effort: 'S',
        dependencies: [],
        description: 'Short',
        priority: 10,
      });

      const result = selector.selectModel(workItem);

      expect(result.model).toBe('custom-simple');
    });

    test('should use custom scorer', () => {
      const mockScorer: IComplexityScorer = {
        score: (): ComplexityScore => ({
          score: 80,
          tier: 'complex',
          factors: [],
        }),
      };

      const selector = new ModelSelector(undefined, mockScorer);
      const workItem = createWorkItem();

      const result = selector.selectModel(workItem);

      expect(result.tier).toBe('complex');
      expect(result.model).toBe('claude-opus-4-5-20251101');
    });
  });

  describe('default configuration', () => {
    test('should have correct default models (Claude-first strategy)', () => {
      expect(DEFAULT_MODEL_TIER_CONFIG.simple.primary).toBe('claude-haiku-4-5-20251001');
      expect(DEFAULT_MODEL_TIER_CONFIG.medium.primary).toBe('claude-sonnet-4-5-20250929');
      expect(DEFAULT_MODEL_TIER_CONFIG.complex.primary).toBe('claude-opus-4-5-20251101');
    });

    test('should have fallback models configured (OpenAI gpt-5.2)', () => {
      expect(DEFAULT_MODEL_TIER_CONFIG.simple.fallback).toBe('gpt-5.2');
      expect(DEFAULT_MODEL_TIER_CONFIG.medium.fallback).toBe('gpt-5.2');
      expect(DEFAULT_MODEL_TIER_CONFIG.complex.fallback).toBe('gpt-5.2');
    });
  });
});
