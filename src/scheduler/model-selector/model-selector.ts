import type { Goal, WorkItem } from '../../work-order/types/index.js';
import type {
  IModelSelector,
  IComplexityScorer,
  ModelTierConfig,
  ModelSelectionResult,
  ComplexityScore,
  ModelTier,
} from './types.js';
import { ComplexityScorer } from './complexity-scorer.js';
import { loadModelTierConfig } from './model-tier-config.js';

export class ModelSelector implements IModelSelector {
  private config: ModelTierConfig;
  private scorer: IComplexityScorer;

  constructor(config?: ModelTierConfig, scorer?: IComplexityScorer) {
    this.config = config ?? loadModelTierConfig();
    this.scorer = scorer ?? new ComplexityScorer();
  }

  selectModel(workItem: WorkItem): ModelSelectionResult {
    const complexityScore = this.scorer.score(workItem);
    const model = this.getModelForTier(complexityScore.tier);
    const reasoning = this.buildReasoning(workItem.title, complexityScore);

    return {
      model,
      tier: complexityScore.tier,
      complexityScore,
      reasoning,
    };
  }

  selectModelForPlanning(goal: Goal): ModelSelectionResult {
    const complexityScore = this.scoreGoal(goal);
    const model = this.getModelForTier(complexityScore.tier);
    const reasoning = this.buildReasoning(goal.title, complexityScore);

    return {
      model,
      tier: complexityScore.tier,
      complexityScore,
      reasoning,
    };
  }

  private scoreGoal(goal: Goal): ComplexityScore {
    const factors = [];

    // Description length (40%)
    const descLen = goal.description.length;
    const descValue = descLen < 100 ? 20 : descLen < 500 ? 50 : descLen < 1000 ? 75 : 100;
    factors.push({
      name: 'description_length',
      weight: 0.40,
      value: descValue,
      contribution: descValue * 0.40,
    });

    // Success criteria count (30%)
    const criteriaCount = goal.success_criteria.length;
    const criteriaValue = criteriaCount <= 1 ? 20 : criteriaCount <= 3 ? 50 : criteriaCount <= 5 ? 75 : 100;
    factors.push({
      name: 'success_criteria',
      weight: 0.30,
      value: criteriaValue,
      contribution: criteriaValue * 0.30,
    });

    // Priority (20%)
    const priorityValue = Math.min(100, Math.max(0, goal.priority));
    factors.push({
      name: 'priority',
      weight: 0.20,
      value: priorityValue,
      contribution: priorityValue * 0.20,
    });

    // Budget (10%) - larger budgets suggest more complex tasks
    const budgetTokens = goal.budget_tokens ?? 0;
    const budgetValue = budgetTokens < 10000 ? 20 : budgetTokens < 50000 ? 50 : budgetTokens < 100000 ? 75 : 100;
    factors.push({
      name: 'budget_tokens',
      weight: 0.10,
      value: budgetValue,
      contribution: budgetValue * 0.10,
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
    if (score <= 35) return 'simple';
    if (score <= 65) return 'medium';
    return 'complex';
  }

  private getModelForTier(tier: ModelTier): string {
    return this.config[tier].primary;
  }

  private buildReasoning(title: string, score: ComplexityScore): string {
    const topFactors = score.factors
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 3)
      .map(f => `${f.name}=${f.value}`)
      .join(', ');

    return `Task "${title}" scored ${score.score}/100 (${score.tier} tier). Key factors: ${topFactors}`;
  }
}
