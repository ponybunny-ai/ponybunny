import type { AgentId, ModelTier, LLMAgentConfig, LLMTierConfig } from './types.js';
import { getCachedConfig } from './config-loader.js';
import { getEndpointManager } from './endpoint-manager.js';

/**
 * Agent Model Resolver
 * Resolves agent IDs and tiers to specific models with fallback chains
 */
export class AgentModelResolver {
  /**
   * Get the primary model for an agent
   */
  getModelForAgent(agentId: AgentId): string {
    const config = getCachedConfig();
    const agentConfig = config.agents[agentId];

    if (!agentConfig) {
      // Unknown agent, use medium tier as default
      console.warn(`[AgentModelResolver] Unknown agent '${agentId}', using medium tier`);
      return config.tiers.medium.primary;
    }

    // Agent-specific primary model takes precedence
    if (agentConfig.primary) {
      return agentConfig.primary;
    }

    // Fall back to tier's primary model
    const tier = agentConfig.tier || 'medium';
    return config.tiers[tier].primary;
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
  getFallbackChain(agentId: AgentId): string[] {
    const config = getCachedConfig();
    const agentConfig = config.agents[agentId];

    if (!agentConfig) {
      // Unknown agent, use medium tier
      const tierConfig = config.tiers.medium;
      return [tierConfig.primary, ...(tierConfig.fallback || [])];
    }

    // Agent-specific fallback chain takes precedence
    if (agentConfig.fallback && agentConfig.fallback.length > 0) {
      const primary = agentConfig.primary || this.getModelForAgent(agentId);
      return [primary, ...agentConfig.fallback];
    }

    // Use tier's fallback chain
    const tier = agentConfig.tier || 'medium';
    const tierConfig = config.tiers[tier];
    const primary = agentConfig.primary || tierConfig.primary;

    return [primary, ...(tierConfig.fallback || [])];
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
  async getFirstAvailableModel(agentId: AgentId): Promise<string | undefined> {
    const chain = this.getFallbackChain(agentId);
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
  getAgentConfig(agentId: AgentId): LLMAgentConfig | undefined {
    const config = getCachedConfig();
    return config.agents[agentId];
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
  getAllAgentIds(): string[] {
    const config = getCachedConfig();
    return Object.keys(config.agents);
  }

  /**
   * Check if an agent is configured
   */
  isAgentConfigured(agentId: AgentId): boolean {
    const config = getCachedConfig();
    return agentId in config.agents;
  }

  /**
   * Get the tier for an agent
   */
  getTierForAgent(agentId: AgentId): ModelTier {
    const config = getCachedConfig();
    const agentConfig = config.agents[agentId];
    return agentConfig?.tier || 'medium';
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
let instance: AgentModelResolver | null = null;

/**
 * Get the singleton AgentModelResolver instance
 */
export function getAgentModelResolver(): AgentModelResolver {
  if (!instance) {
    instance = new AgentModelResolver();
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetAgentModelResolver(): void {
  instance = null;
}
