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
      });

      const result = scorer.score(workItem);
      expect(result.tier).toBe('medium');
      expect(result.score).toBeGreaterThan(35);
      expect(result.score).toBeLessThanOrEqual(65);
    });

    test('should classify complex tasks (score > 65)', () => {
      const workItem = createWorkItem({
        item_type: 'refactor',
        estimated_effort: 'XL',
        dependencies: ['dep-1', 'dep-2', 'dep-3', 'dep-4', 'dep-5'],
        verification_plan: {
          quality_gates: [
            { name: 'test', type: 'deterministic', required: true },
            { name: 'lint', type: 'deterministic', required: true },
            { name: 'build', type: 'deterministic', required: true },
            { name: 'coverage', type: 'llm_review', required: false },
            { name: 'security', type: 'llm_review', required: false },
          ],
          acceptance_criteria: [],
        },
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
      const refactorItem = createWorkItem({ item_type: 'refactor' });

      expect(scorer.score(docItem).factors.find(f => f.name === 'item_type')?.value).toBe(20);
      expect(scorer.score(analysisItem).factors.find(f => f.name === 'item_type')?.value).toBe(60);
      expect(scorer.score(refactorItem).factors.find(f => f.name === 'item_type')?.value).toBe(90);
    });

    test('should score estimated_effort correctly', () => {
      const smallItem = createWorkItem({ estimated_effort: 'S' });
      const xlItem = createWorkItem({ estimated_effort: 'XL' });

      expect(scorer.score(smallItem).factors.find(f => f.name === 'estimated_effort')?.value).toBe(20);
      expect(scorer.score(xlItem).factors.find(f => f.name === 'estimated_effort')?.value).toBe(100);
    });

    test('should score dependency_count correctly', () => {
      const noDeps = createWorkItem({ dependencies: [] });
      const twoDeps = createWorkItem({ dependencies: ['a', 'b'] });
      const fiveDeps = createWorkItem({ dependencies: ['a', 'b', 'c', 'd', 'e'] });

      expect(scorer.score(noDeps).factors.find(f => f.name === 'dependency_count')?.value).toBe(0);
      expect(scorer.score(twoDeps).factors.find(f => f.name === 'dependency_count')?.value).toBe(40);
      expect(scorer.score(fiveDeps).factors.find(f => f.name === 'dependency_count')?.value).toBe(100);
    });

    test('should score quality_gates_count correctly', () => {
      const noGates = createWorkItem();
      const withGates = createWorkItem({
        verification_plan: {
          quality_gates: [
            { name: 'test', type: 'deterministic', required: true },
            { name: 'lint', type: 'deterministic', required: true },
            { name: 'build', type: 'deterministic', required: true },
          ],
          acceptance_criteria: [],
        },
      });

      expect(scorer.score(noGates).factors.find(f => f.name === 'quality_gates_count')?.value).toBe(0);
      expect(scorer.score(withGates).factors.find(f => f.name === 'quality_gates_count')?.value).toBe(60);
    });

    test('should not include description_length or priority factors', () => {
      const workItem = createWorkItem();
      const result = scorer.score(workItem);

      expect(result.factors.find(f => f.name === 'description_length')).toBeUndefined();
      expect(result.factors.find(f => f.name === 'priority')).toBeUndefined();
      expect(result.factors.find(f => f.name === 'retry_count')).toBeUndefined();
    });
  });

  describe('factor weights', () => {
    test('should have weights summing to 1.0', () => {
      const workItem = createWorkItem();
      const result = scorer.score(workItem);

      const totalWeight = result.factors.reduce((sum, f) => sum + f.weight, 0);
      expect(totalWeight).toBeCloseTo(1.0, 5);
    });

    test('should have exactly 4 factors', () => {
      const workItem = createWorkItem();
      const result = scorer.score(workItem);
      expect(result.factors).toHaveLength(4);
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

    test('item_type and estimated_effort should dominate scoring (70%)', () => {
      const workItem = createWorkItem();
      const result = scorer.score(workItem);

      const itemType = result.factors.find(f => f.name === 'item_type')!;
      const effort = result.factors.find(f => f.name === 'estimated_effort')!;

      expect(itemType.weight + effort.weight).toBeCloseTo(0.70, 5);
    });
  });
});
