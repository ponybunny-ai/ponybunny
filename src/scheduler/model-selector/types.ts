import type { Goal, WorkItem } from '../../work-order/types/index.js';

export type ModelTier = 'simple' | 'medium' | 'complex';

export interface ComplexityScore {
  score: number;           // 0-100
  tier: ModelTier;
  factors: ComplexityFactor[];
}

export interface ComplexityFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
}

export interface ModelTierConfig {
  simple: ModelConfig;
  medium: ModelConfig;
  complex: ModelConfig;
}

export interface ModelConfig {
  primary: string;
  fallback?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ModelSelectionResult {
  model: string;
  tier: ModelTier;
  complexityScore: ComplexityScore;
  reasoning: string;
}

export interface IModelSelector {
  selectModel(workItem: WorkItem): ModelSelectionResult;
  selectModelForPlanning(goal: Goal): ModelSelectionResult;
}

export interface IComplexityScorer {
  score(workItem: WorkItem): ComplexityScore;
}
