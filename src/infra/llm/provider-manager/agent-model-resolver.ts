import type { WorkloadId, ModelTier, LLMWorkloadConfig, LLMTierConfig } from './types.js';
import { getCachedConfig } from './config-loader.js';
import { getEndpointManager } from './endpoint-manager.js';
import { getGlobalAgentRegistry } from '../../agents/agent-registry.js';
import { loadRuntimeConfig } from '../../config/runtime-config.js';

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function dedupeModelChain(models: string[]): string[] {
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const model of models) {
    if (!seen.has(model)) {
      seen.add(model);
      chain.push(model);
    }
  }
  return chain;
}

/**
 * Agent Model Resolver
 * Resolves agent IDs and tiers to specific models with fallback chains
 */
export class WorkloadModelResolver {
  private getRuntimeModelOverride(workloadId: WorkloadId): string | undefined {
    const runtime = loadRuntimeConfig();
    const rawOverride = runtime.agent.modelOverrides?.[workloadId];
    const normalized = normalizeOptionalString(rawOverride);
    if (!normalized) {
      return undefined;
    }

    if (normalized.toLowerCase() === 'auto') {
      return undefined;
    }

    return normalized;
  }

  private getAgentModelHint(workloadId: WorkloadId): string | undefined {
    const agent = getGlobalAgentRegistry().getAgent(workloadId);
    if (!agent) {
      return undefined;
    }

    const runnerConfig = (agent.config.runner.config ?? {}) as Record<string, unknown>;
    return normalizeOptionalString(runnerConfig.model) ?? normalizeOptionalString(runnerConfig.model_hint);
  }

  /**
   * Get the primary model for an agent
   */
  getModelForWorkload(workloadId: WorkloadId): string {
    const runtimeOverride = this.getRuntimeModelOverride(workloadId);
    if (runtimeOverride) {
      return runtimeOverride;
    }

    const agentModel = this.getAgentModelHint(workloadId);
    if (agentModel) {
      return agentModel;
    }

    const config = getCachedConfig();
    const tier = config.workloads[workloadId]?.tier || 'medium';

    return config.tiers[tier].primary;
  }

  private getTierChainForWorkload(workloadId: WorkloadId): string[] {
    const config = getCachedConfig();
    const workloadConfig = config.workloads[workloadId];
    const tier = workloadConfig?.tier || 'medium';
    const tierConfig = config.tiers[tier];

    return [tierConfig.primary, ...(tierConfig.fallback || [])];
  }

  getSelectionChainForWorkload(workloadId: WorkloadId, userSelectedModel?: string): string[] {
    const tierChain = this.getTierChainForWorkload(workloadId);
    const runtimeOverride = this.getRuntimeModelOverride(workloadId);
    const agentModel = this.getAgentModelHint(workloadId);
    const userModel = normalizeOptionalString(userSelectedModel);

    return dedupeModelChain([
      ...(runtimeOverride ? [runtimeOverride] : []),
      ...(userModel ? [userModel] : []),
      ...(agentModel ? [agentModel] : []),
      ...tierChain,
    ]);
  }

  /**
   * Get the primary model for a tier
   */
  getModelForTier(tier: ModelTier): string {
    const config = getCachedConfig();
    return config.tiers[tier].primary;
  }

  /**
   * Get the complete fallback chain for an agent
   * Returns [primary, ...fallbacks] in order of preference
   */
  getFallbackChain(workloadId: WorkloadId): string[] {
    return this.getSelectionChainForWorkload(workloadId);
  }

  /**
   * Get the fallback chain for a tier
   */
  getFallbackChainForTier(tier: ModelTier): string[] {
    const config = getCachedConfig();
    const tierConfig = config.tiers[tier];
    return [tierConfig.primary, ...(tierConfig.fallback || [])];
  }

  /**
   * Get the first available model from a fallback chain
   * Checks endpoint availability for each model
   */
  async getFirstAvailableModel(workloadId: WorkloadId): Promise<string | undefined> {
    const chain = this.getFallbackChain(workloadId);
    const endpointManager = getEndpointManager();

    for (const modelId of chain) {
      const endpoints = await endpointManager.getAvailableEndpointsForModel(modelId);
      if (endpoints.length > 0) {
        return modelId;
      }
    }

    return undefined;
  }

  /**
   * Get the first available model from a tier's fallback chain
   */
  async getFirstAvailableModelForTier(tier: ModelTier): Promise<string | undefined> {
    const chain = this.getFallbackChainForTier(tier);
    const endpointManager = getEndpointManager();

    for (const modelId of chain) {
      const endpoints = await endpointManager.getAvailableEndpointsForModel(modelId);
      if (endpoints.length > 0) {
        return modelId;
      }
    }

    return undefined;
  }

  /**
   * Get agent configuration
   */
  getWorkloadConfig(workloadId: WorkloadId): LLMWorkloadConfig | undefined {
    const config = getCachedConfig();
    return config.workloads[workloadId];
  }

  /**
   * Get tier configuration
   */
  getTierConfig(tier: ModelTier): LLMTierConfig {
    const config = getCachedConfig();
    return config.tiers[tier];
  }

  /**
   * Get all configured agent IDs
   */
  getAllWorkloadIds(): string[] {
    const config = getCachedConfig();
    return Object.keys(config.workloads);
  }

  /**
   * Check if an agent is configured
   */
  isWorkloadConfigured(workloadId: WorkloadId): boolean {
    const config = getCachedConfig();
    return workloadId in config.workloads;
  }

  /**
   * Get the tier for an agent
   */
  getTierForWorkload(workloadId: WorkloadId): ModelTier {
    const config = getCachedConfig();
    const workloadConfig = config.workloads[workloadId];
    return workloadConfig?.tier || 'medium';
  }

  /**
   * Estimate cost for a model
   */
  estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const config = getCachedConfig();
    const modelConfig = config.models[modelId];

    if (!modelConfig) {
      // Unknown model, use a default estimate
      return (inputTokens + outputTokens) * 0.00001;
    }

    const inputCost = (inputTokens / 1000) * modelConfig.costPer1kTokens.input;
    const outputCost = (outputTokens / 1000) * modelConfig.costPer1kTokens.output;

    return inputCost + outputCost;
  }
}

// Singleton instance
let instance: WorkloadModelResolver | null = null;

/**
 * Get the singleton WorkloadModelResolver instance
 */
export function getWorkloadModelResolver(): WorkloadModelResolver {
  if (!instance) {
    instance = new WorkloadModelResolver();
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetWorkloadModelResolver(): void {
  instance = null;
}
