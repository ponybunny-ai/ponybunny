import type { WorkItem, WorkItemType, EffortEstimate } from '../../work-order/types/index.js';
import type { IComplexityScorer, ComplexityScore, ComplexityFactor, ModelTier } from './types.js';

/**
 * Item type complexity scores.
 * Reflects actual LLM computation difficulty, not importance.
 * Refactoring requires understanding existing code + restructuring = highest.
 * Documentation is straightforward = lowest.
 */
const ITEM_TYPE_SCORES: Record<WorkItemType, number> = {
  doc: 20,
  test: 40,
  analysis: 60,
  code: 70,
  refactor: 90,
};

const EFFORT_SCORES: Record<EffortEstimate, number> = {
  S: 20,
  M: 50,
  L: 75,
  XL: 100,
};

const TIER_THRESHOLDS = {
  simple: 35,
  medium: 65,
};

export class ComplexityScorer implements IComplexityScorer {
  score(workItem: WorkItem): ComplexityScore {
    const factors: ComplexityFactor[] = [];

    // Factor 1: Item type (35%) — strongest signal of LLM computation difficulty
    const itemTypeValue = ITEM_TYPE_SCORES[workItem.item_type] ?? 50;
    factors.push({
      name: 'item_type',
      weight: 0.35,
      value: itemTypeValue,
      contribution: itemTypeValue * 0.35,
    });

    // Factor 2: Estimated effort (35%) — human estimate, more reliable than description length
    const effortValue = EFFORT_SCORES[workItem.estimated_effort] ?? 50;
    factors.push({
      name: 'estimated_effort',
      weight: 0.35,
      value: effortValue,
      contribution: effortValue * 0.35,
    });

    // Factor 3: Dependency count (20%) — more deps = more integration complexity
    const depCount = workItem.dependencies.length;
    const depValue = Math.min(depCount / 5, 1) * 100;
    factors.push({
      name: 'dependency_count',
      weight: 0.20,
      value: Math.round(depValue),
      contribution: depValue * 0.20,
    });

    // Factor 4: Quality gates count (10%) — more gates = more verification complexity
    const gateCount = workItem.verification_plan?.quality_gates?.length ?? 0;
    const gateValue = Math.min(gateCount / 5, 1) * 100;
    factors.push({
      name: 'quality_gates_count',
      weight: 0.10,
      value: Math.round(gateValue),
      contribution: gateValue * 0.10,
    });

    // Removed: description_length (not correlated with LLM complexity)
    // Removed: priority (importance ≠ computational difficulty)
    // Removed: retry_count (retries handled by RetryHandler, not model selection)

    const totalScore = factors.reduce((sum, f) => sum + f.contribution, 0);
    const tier = this.determineTier(totalScore);

    return {
      score: Math.round(totalScore),
      tier,
      factors,
    };
  }

  private determineTier(score: number): ModelTier {
    if (score <= TIER_THRESHOLDS.simple) {
      return 'simple';
    }
    if (score <= TIER_THRESHOLDS.medium) {
      return 'medium';
    }
    return 'complex';
  }
}
