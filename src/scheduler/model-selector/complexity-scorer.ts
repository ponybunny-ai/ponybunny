import type { WorkItem, WorkItemType, EffortEstimate } from '../../work-order/types/index.js';
import type { IComplexityScorer, ComplexityScore, ComplexityFactor, ModelTier } from './types.js';

const ITEM_TYPE_SCORES: Record<WorkItemType, number> = {
  doc: 20,
  test: 40,
  refactor: 50,
  code: 60,
  analysis: 70,
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

    // Factor 1: Item type (25%)
    const itemTypeValue = ITEM_TYPE_SCORES[workItem.item_type] ?? 50;
    factors.push({
      name: 'item_type',
      weight: 0.25,
      value: itemTypeValue,
      contribution: itemTypeValue * 0.25,
    });

    // Factor 2: Estimated effort (30%)
    const effortValue = EFFORT_SCORES[workItem.estimated_effort] ?? 50;
    factors.push({
      name: 'estimated_effort',
      weight: 0.30,
      value: effortValue,
      contribution: effortValue * 0.30,
    });

    // Factor 3: Dependencies count (15%)
    const depCount = workItem.dependencies.length;
    const depValue = depCount === 0 ? 0 : depCount <= 2 ? 30 : depCount <= 4 ? 60 : 100;
    factors.push({
      name: 'dependencies',
      weight: 0.15,
      value: depValue,
      contribution: depValue * 0.15,
    });

    // Factor 4: Description length (15%)
    const descLen = workItem.description.length;
    const descValue = descLen < 100 ? 20 : descLen < 500 ? 50 : descLen < 1000 ? 75 : 100;
    factors.push({
      name: 'description_length',
      weight: 0.15,
      value: descValue,
      contribution: descValue * 0.15,
    });

    // Factor 5: Priority (10%)
    const priorityValue = Math.min(100, Math.max(0, workItem.priority));
    factors.push({
      name: 'priority',
      weight: 0.10,
      value: priorityValue,
      contribution: priorityValue * 0.10,
    });

    // Factor 6: Retry count (5%)
    const retryValue = workItem.retry_count === 0 ? 0 : workItem.retry_count === 1 ? 50 : 100;
    factors.push({
      name: 'retry_count',
      weight: 0.05,
      value: retryValue,
      contribution: retryValue * 0.05,
    });

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
