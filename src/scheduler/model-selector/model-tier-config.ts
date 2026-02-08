import type { ModelTierConfig } from './types.js';

/**
 * Default model tier configuration - Claude-first strategy
 * Claude Opus 4.5 is the primary model for complex tasks
 */
export const DEFAULT_MODEL_TIER_CONFIG: ModelTierConfig = {
  simple: {
    primary: 'claude-haiku-4-5',
    fallback: 'gpt-5.2',
    temperature: 0.2,
  },
  medium: {
    primary: 'claude-sonnet-4-5',
    fallback: 'gpt-5.2',
    temperature: 0.2,
  },
  complex: {
    primary: 'claude-opus-4-5',
    fallback: 'gpt-5.2',
    temperature: 0.3,
  },
};

export function loadModelTierConfig(): ModelTierConfig {
  const config = { ...DEFAULT_MODEL_TIER_CONFIG };

  // Primary model overrides
  const simpleModel = process.env.PONY_MODEL_SIMPLE;
  const mediumModel = process.env.PONY_MODEL_MEDIUM;
  const complexModel = process.env.PONY_MODEL_COMPLEX;

  // Fallback model overrides
  const simpleFallback = process.env.PONY_MODEL_SIMPLE_FALLBACK;
  const mediumFallback = process.env.PONY_MODEL_MEDIUM_FALLBACK;
  const complexFallback = process.env.PONY_MODEL_COMPLEX_FALLBACK;

  if (simpleModel) {
    config.simple = { ...config.simple, primary: simpleModel };
  }
  if (simpleFallback) {
    config.simple = { ...config.simple, fallback: simpleFallback };
  }
  if (mediumModel) {
    config.medium = { ...config.medium, primary: mediumModel };
  }
  if (mediumFallback) {
    config.medium = { ...config.medium, fallback: mediumFallback };
  }
  if (complexModel) {
    config.complex = { ...config.complex, primary: complexModel };
  }
  if (complexFallback) {
    config.complex = { ...config.complex, fallback: complexFallback };
  }

  return config;
}
