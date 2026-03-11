import type { ModelTier, WorkloadId } from './types.js';
import { getCachedConfig } from './config-loader.js';

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.toLowerCase() === 'auto' ? undefined : trimmed;
}

export type EffectiveModelResolutionSource =
  | 'runtime_override'
  | 'agent_runner_hint'
  | 'llm_config_tier';

export interface EffectiveModelResolution {
  model: string;
  source: EffectiveModelResolutionSource;
  tier?: ModelTier;
}

export interface EffectiveModelResolutionInput {
  runtimeOverrideModel?: unknown;
  agentModelHint?: unknown;
  defaultModel?: unknown;
  defaultSource?: EffectiveModelResolutionSource;
  tier?: ModelTier;
}

/**
 * Authority read path for effective pre-execution model selection.
 * Transport/UI/persistence surfaces should consume its result as projections,
 * not re-implement the precedence rules locally.
 */
export function resolveEffectiveModelSelection(
  input: EffectiveModelResolutionInput
): EffectiveModelResolution | undefined {
  const runtimeOverride = normalizeOptionalString(input.runtimeOverrideModel);
  if (runtimeOverride) {
    return {
      model: runtimeOverride,
      source: 'runtime_override',
      tier: input.tier,
    };
  }

  const agentModelHint = normalizeOptionalString(input.agentModelHint);
  if (agentModelHint) {
    return {
      model: agentModelHint,
      source: 'agent_runner_hint',
      tier: input.tier,
    };
  }

  const defaultModel = normalizeOptionalString(input.defaultModel);
  if (!defaultModel) {
    return undefined;
  }

  return {
    model: defaultModel,
    source: input.defaultSource ?? 'llm_config_tier',
    tier: input.tier,
  };
}

export function getTierForWorkload(workloadId: WorkloadId): ModelTier {
  const config = getCachedConfig();
  const workloadConfig = config.workloads[workloadId];
  return workloadConfig?.tier || 'medium';
}

export function getTierPrimaryModel(tier: ModelTier): string {
  const config = getCachedConfig();
  return config.tiers[tier].primary;
}

export function getWorkloadTierPrimaryModel(workloadId: WorkloadId): {
  model: string;
  tier: ModelTier;
} {
  const tier = getTierForWorkload(workloadId);
  return {
    model: getTierPrimaryModel(tier),
    tier,
  };
}
