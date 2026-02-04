import { ComplexityScorer } from '../../../src/scheduler/model-selector/complexity-scorer.js';
import type { WorkItem } from '../../../src/work-order/types/index.js';

describe('ComplexityScorer', () => {
  let scorer: ComplexityScorer;

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

  beforeEach(() => {
    scorer = new ComplexityScorer();
  });

  describe('tier classification', () => {
    test('should classify simple tasks (score <= 35)', () => {
      const workItem = createWorkItem({
        item_type: 'doc',
        estimated_effort: 'S',
        dependencies: [],
        description: 'Short',
        priority: 10,
        retry_count: 0,
      });

      const result = scorer.score(workItem);

      expect(result.tier).toBe('simple');
      expect(result.score).toBeLessThanOrEqual(35);
    });

    test('should classify medium tasks (36-65)', () => {
      const workItem = createWorkItem({
        item_type: 'code',
        estimated_effort: 'M',
        dependencies: ['dep-1'],
        description: 'A medium length description that provides some context',
        priority: 50,
        retry_count: 0,
      });

      const result = scorer.score(workItem);

      expect(result.tier).toBe('medium');
      expect(result.score).toBeGreaterThan(35);
      expect(result.score).toBeLessThanOrEqual(65);
    });

    test('should classify complex tasks (score > 65)', () => {
      const workItem = createWorkItem({
        item_type: 'analysis',
        estimated_effort: 'XL',
        dependencies: ['dep-1', 'dep-2', 'dep-3', 'dep-4', 'dep-5'],
        description: 'A'.repeat(1200),
        priority: 90,
        retry_count: 2,
      });

      const result = scorer.score(workItem);

      expect(result.tier).toBe('complex');
      expect(result.score).toBeGreaterThan(65);
    });
  });

  describe('factor scoring', () => {
    test('should score item_type correctly', () => {
      const docItem = createWorkItem({ item_type: 'doc' });
      const analysisItem = createWorkItem({ item_type: 'analysis' });

      const docResult = scorer.score(docItem);
      const analysisResult = scorer.score(analysisItem);

      const docFactor = docResult.factors.find(f => f.name === 'item_type');
      const analysisFactor = analysisResult.factors.find(f => f.name === 'item_type');

      expect(docFactor?.value).toBe(20);
      expect(analysisFactor?.value).toBe(70);
    });

    test('should score estimated_effort correctly', () => {
      const smallItem = createWorkItem({ estimated_effort: 'S' });
      const xlItem = createWorkItem({ estimated_effort: 'XL' });

      const smallResult = scorer.score(smallItem);
      const xlResult = scorer.score(xlItem);

      const smallFactor = smallResult.factors.find(f => f.name === 'estimated_effort');
      const xlFactor = xlResult.factors.find(f => f.name === 'estimated_effort');

      expect(smallFactor?.value).toBe(20);
      expect(xlFactor?.value).toBe(100);
    });

    test('should score dependencies correctly', () => {
      const noDeps = createWorkItem({ dependencies: [] });
      const twoDeps = createWorkItem({ dependencies: ['a', 'b'] });
      const fiveDeps = createWorkItem({ dependencies: ['a', 'b', 'c', 'd', 'e'] });

      const noResult = scorer.score(noDeps);
      const twoResult = scorer.score(twoDeps);
      const fiveResult = scorer.score(fiveDeps);

      expect(noResult.factors.find(f => f.name === 'dependencies')?.value).toBe(0);
      expect(twoResult.factors.find(f => f.name === 'dependencies')?.value).toBe(30);
      expect(fiveResult.factors.find(f => f.name === 'dependencies')?.value).toBe(100);
    });

    test('should score description_length correctly', () => {
      const short = createWorkItem({ description: 'Short' });
      const medium = createWorkItem({ description: 'A'.repeat(300) });
      const long = createWorkItem({ description: 'A'.repeat(800) });
      const veryLong = createWorkItem({ description: 'A'.repeat(1500) });

      expect(scorer.score(short).factors.find(f => f.name === 'description_length')?.value).toBe(20);
      expect(scorer.score(medium).factors.find(f => f.name === 'description_length')?.value).toBe(50);
      expect(scorer.score(long).factors.find(f => f.name === 'description_length')?.value).toBe(75);
      expect(scorer.score(veryLong).factors.find(f => f.name === 'description_length')?.value).toBe(100);
    });

    test('should score retry_count correctly', () => {
      const noRetry = createWorkItem({ retry_count: 0 });
      const oneRetry = createWorkItem({ retry_count: 1 });
      const multiRetry = createWorkItem({ retry_count: 3 });

      expect(scorer.score(noRetry).factors.find(f => f.name === 'retry_count')?.value).toBe(0);
      expect(scorer.score(oneRetry).factors.find(f => f.name === 'retry_count')?.value).toBe(50);
      expect(scorer.score(multiRetry).factors.find(f => f.name === 'retry_count')?.value).toBe(100);
    });

    test('should clamp priority to 0-100', () => {
      const lowPriority = createWorkItem({ priority: -10 });
      const highPriority = createWorkItem({ priority: 150 });

      expect(scorer.score(lowPriority).factors.find(f => f.name === 'priority')?.value).toBe(0);
      expect(scorer.score(highPriority).factors.find(f => f.name === 'priority')?.value).toBe(100);
    });
  });

  describe('factor weights', () => {
    test('should have weights summing to 1.0', () => {
      const workItem = createWorkItem();
      const result = scorer.score(workItem);

      const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 5);
    });

    test('should calculate contributions correctly', () => {
      const workItem = createWorkItem();
      const result = scorer.score(workItem);

      for (const factor of result.factors) {
        expect(factor.contribution).toBeCloseTo(factor.value * factor.weight, 5);
      }
    });

    test('should calculate total score from contributions', () => {
      const workItem = createWorkItem();
      const result = scorer.score(workItem);

      const expectedScore = result.factors.reduce((sum, f) => sum + f.contribution, 0);
      expect(result.score).toBe(Math.round(expectedScore));
    });
  });
});
