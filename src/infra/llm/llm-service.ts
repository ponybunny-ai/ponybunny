import type { ILLMProvider, LLMMessage, LLMResponse, LLMProviderConfig } from './llm-provider.js';
import { LLMProviderError, LLMRouter } from './llm-provider.js';
import type { LLMProviderRegistry } from './provider-registry.js';
import { getProviderRegistry, estimateModelCost } from './provider-factory.js';
import { UnifiedLLMProvider } from './unified-provider.js';
import { getModelRouter } from './routing/index.js';
import type { ModelTier } from '../../scheduler/model-selector/types.js';
import { getLLMProviderManager } from './provider-manager/index.js';
import type { AgentId, LLMCompletionOptions } from './provider-manager/index.js';
import { debug } from '../../debug/index.js';

/**
 * Model tier configuration with primary and fallback models
 */
export interface TierModelConfig {
  primary: string;
  fallback: string;
}

/**
 * Default tier configuration - Claude-first strategy
 */
export const DEFAULT_TIER_MODELS: Record<ModelTier, TierModelConfig> = {
  simple: {
    primary: 'claude-haiku-4-5',
    fallback: 'gpt-5.2',
  },
  medium: {
    primary: 'claude-sonnet-4-5',
    fallback: 'gpt-5.2',
  },
  complex: {
    primary: 'claude-opus-4-5',
    fallback: 'gpt-5.2',
  },
};

/**
 * Load tier models from environment variables with defaults
 */
function loadTierModels(): Record<ModelTier, TierModelConfig> {
  return {
    simple: {
      primary: process.env.PONY_MODEL_SIMPLE || DEFAULT_TIER_MODELS.simple.primary,
      fallback: process.env.PONY_MODEL_SIMPLE_FALLBACK || DEFAULT_TIER_MODELS.simple.fallback,
    },
    medium: {
      primary: process.env.PONY_MODEL_MEDIUM || DEFAULT_TIER_MODELS.medium.primary,
      fallback: process.env.PONY_MODEL_MEDIUM_FALLBACK || DEFAULT_TIER_MODELS.medium.fallback,
    },
    complex: {
      primary: process.env.PONY_MODEL_COMPLEX || DEFAULT_TIER_MODELS.complex.primary,
      fallback: process.env.PONY_MODEL_COMPLEX_FALLBACK || DEFAULT_TIER_MODELS.complex.fallback,
    },
  };
}

/**
 * LLM Service configuration
 */
export interface LLMServiceConfig {
  /** Custom tier model configuration */
  tierModels?: Partial<Record<ModelTier, Partial<TierModelConfig>>>;
  /** Default timeout in ms */
  defaultTimeout?: number;
  /** Default max tokens */
  defaultMaxTokens?: number;
  /** Use unified provider with protocol/endpoint decoupling (default: true) */
  useUnifiedProvider?: boolean;
}

/**
 * Unified LLM Service for the Scheduler
 * Provides a single interface for all LLM operations with automatic provider routing
 *
 * Now uses UnifiedLLMProvider internally for protocol/endpoint decoupling,
 * enabling same model access through different providers (e.g., Claude via Anthropic or AWS Bedrock)
 */
export class LLMService implements ILLMProvider {
  private registry: LLMProviderRegistry;
  private tierModels: Record<ModelTier, TierModelConfig>;
  private config: LLMServiceConfig;
  private providerCache = new Map<string, ILLMProvider>();
  private unifiedProvider: UnifiedLLMProvider | null = null;

  constructor(config: LLMServiceConfig = {}) {
    this.registry = getProviderRegistry();
    this.config = config;

    // Load tier models with environment overrides
    const envTierModels = loadTierModels();
    this.tierModels = {
      simple: { ...envTierModels.simple, ...config.tierModels?.simple },
      medium: { ...envTierModels.medium, ...config.tierModels?.medium },
      complex: { ...envTierModels.complex, ...config.tierModels?.complex },
    };

    // Initialize unified provider if enabled (default: true)
    if (config.useUnifiedProvider !== false) {
      this.unifiedProvider = new UnifiedLLMProvider({
        defaultTimeout: config.defaultTimeout,
        defaultMaxTokens: config.defaultMaxTokens,
      });
    }
  }

  /**
   * Complete a request, auto-routing to the correct provider based on model name
   * Uses UnifiedLLMProvider for protocol/endpoint decoupling with automatic fallback
   */
  async complete(
    messages: LLMMessage[],
    options?: Partial<LLMProviderConfig>
  ): Promise<LLMResponse> {
    const model = options?.model;
    if (!model) {
      throw new LLMProviderError('Model must be specified', 'llm-service', false);
    }

    // Use unified provider if available
    if (this.unifiedProvider) {
      return this.unifiedProvider.complete(messages, {
        ...options,
        model,
        timeout: options?.timeout || this.config.defaultTimeout,
        maxTokens: options?.maxTokens || this.config.defaultMaxTokens,
      });
    }

    // Fallback to legacy provider routing
    const provider = this.getProviderForModel(model);
    if (!provider) {
      throw new LLMProviderError(
        `No provider available for model: ${model}`,
        'llm-service',
        false
      );
    }

    return provider.complete(messages, {
      ...options,
      model,
      timeout: options?.timeout || this.config.defaultTimeout,
      maxTokens: options?.maxTokens || this.config.defaultMaxTokens,
    });
  }

  /**
   * Complete a request using tier-based model selection with fallback
   */
  async completeWithTier(
    messages: LLMMessage[],
    tier: ModelTier,
    options?: Partial<Omit<LLMProviderConfig, 'model'>>
  ): Promise<LLMResponse> {
    const tierConfig = this.tierModels[tier];
    const models = [tierConfig.primary, tierConfig.fallback];

    debug.custom('llm.tier.request', 'llm-service', {
      tier,
      primaryModel: tierConfig.primary,
      fallbackModel: tierConfig.fallback,
      messageCount: messages.length,
    });

    let lastError: Error | null = null;

    for (const model of models) {
      try {
        debug.custom('llm.model.attempt', 'llm-service', {
          tier,
          model,
        });

        // Use unified provider if available - it handles endpoint fallback internally
        if (this.unifiedProvider) {
          const response = await this.unifiedProvider.complete(messages, {
            ...options,
            model,
            timeout: options?.timeout || this.config.defaultTimeout,
            maxTokens: options?.maxTokens || this.config.defaultMaxTokens,
          });

          debug.custom('llm.model.success', 'llm-service', {
            tier,
            model,
            responseLength: response.content.length,
            tokensUsed: response.tokensUsed,
          });

          return response;
        }

        // Legacy path
        const provider = this.getProviderForModel(model);
        if (!provider) {
          continue;
        }

        const isAvailable = await provider.isAvailable();
        if (!isAvailable) {
          console.warn(`[LLMService] Provider for ${model} is unavailable, trying fallback`);
          continue;
        }

        const response = await provider.complete(messages, {
          ...options,
          model,
          timeout: options?.timeout || this.config.defaultTimeout,
          maxTokens: options?.maxTokens || this.config.defaultMaxTokens,
        });

        debug.custom('llm.model.success', 'llm-service', {
          tier,
          model,
          responseLength: response.content.length,
          tokensUsed: response.tokensUsed,
        });

        return response;
      } catch (error) {
        lastError = error as Error;
        console.warn(`[LLMService] Model ${model} failed: ${(error as Error).message}`);

        debug.custom('llm.model.failed', 'llm-service', {
          tier,
          model,
          error: (error as Error).message,
          recoverable: error instanceof LLMProviderError ? error.recoverable : true,
        });

        if (error instanceof LLMProviderError && !error.recoverable) {
          throw error;
        }
      }
    }

    throw new LLMProviderError(
      `All models for tier '${tier}' failed. Last error: ${lastError?.message || 'Unknown'}`,
      'llm-service',
      false
    );
  }

  /**
   * Get provider for a specific model (legacy method for backward compatibility)
   */
  private getProviderForModel(model: string): ILLMProvider | undefined {
    // Check cache first
    if (this.providerCache.has(model)) {
      return this.providerCache.get(model);
    }

    // Find provider ID for this model
    const providerId = this.registry.getProviderIdForModel(model);
    if (!providerId) {
      return undefined;
    }

    // Check if API key is available
    if (!this.registry.hasApiKey(providerId)) {
      return undefined;
    }

    // Get metadata for the provider
    const metadata = this.registry.getMetadata(providerId);
    if (!metadata || !metadata.envVarKey) {
      return undefined;
    }

    // Create provider with specific model
    const apiKey = process.env[metadata.envVarKey];
    if (!apiKey) {
      return undefined;
    }

    // Use the factory to create a provider for this specific model
    const { PROVIDER_FACTORIES } = require('./provider-factory.js');
    const factory = PROVIDER_FACTORIES[providerId];
    if (!factory) {
      return undefined;
    }

    const provider = factory({
      apiKey,
      model,
      maxTokens: this.config.defaultMaxTokens || 4000,
    });

    this.providerCache.set(model, provider);
    return provider;
  }

  getName(): string {
    return 'llm-service';
  }

  async isAvailable(): Promise<boolean> {
    // Check unified provider first
    if (this.unifiedProvider) {
      return this.unifiedProvider.isAvailable();
    }
    // Fallback to legacy check
    const providers = this.getAvailableProviders();
    return providers.length > 0;
  }

  estimateCost(tokens: number): number {
    // Use complex tier primary model for estimation
    return estimateModelCost(this.tierModels.complex.primary, tokens / 2, tokens / 2);
  }

  /**
   * Estimate cost for a specific model
   */
  estimateCostForModel(inputTokens: number, outputTokens: number, model: string): number {
    return estimateModelCost(model, inputTokens, outputTokens);
  }

  /**
   * Get list of available provider IDs (those with valid API keys)
   */
  getAvailableProviders(): string[] {
    return this.registry.getAvailableProviderIds();
  }

  /**
   * Get list of available endpoints for a model (new unified provider feature)
   */
  getAvailableEndpointsForModel(model: string): string[] {
    if (this.unifiedProvider) {
      const router = getModelRouter();
      return router.getEndpointsForModel(model).map(e => e.id);
    }
    // Legacy: return provider ID
    const providerId = this.registry.getProviderIdForModel(model);
    return providerId ? [providerId] : [];
  }

  /**
   * Get the tier model configuration
   */
  getTierModels(): Record<ModelTier, TierModelConfig> {
    return { ...this.tierModels };
  }

  /**
   * Get model for a specific tier
   */
  getModelForTier(tier: ModelTier): string {
    const tierConfig = this.tierModels[tier];

    // Check with unified provider
    if (this.unifiedProvider) {
      const router = getModelRouter();
      if (router.isModelSupported(tierConfig.primary)) {
        return tierConfig.primary;
      }
      return tierConfig.fallback;
    }

    // Legacy check
    const primaryProvider = this.getProviderForModel(tierConfig.primary);
    if (primaryProvider) {
      return tierConfig.primary;
    }
    return tierConfig.fallback;
  }

  /**
   * Create an LLMRouter with available providers for backward compatibility
   */
  createRouter(): LLMRouter {
    const providers = this.registry.getAllProviders();
    if (providers.length === 0) {
      throw new Error('No LLM providers available. Please set API keys.');
    }
    return new LLMRouter(providers);
  }

  /**
   * Get the unified provider instance (if enabled)
   */
  getUnifiedProvider(): UnifiedLLMProvider | null {
    return this.unifiedProvider;
  }

  // ============================================
  // New Provider Manager Integration
  // ============================================

  /**
   * Complete a request using agent-based model selection
   * Uses the new LLMProviderManager for configuration-driven model selection
   */
  async completeForAgent(
    agentId: AgentId,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse> {
    const providerManager = getLLMProviderManager();
    return providerManager.complete(agentId, messages, options);
  }

  /**
   * Get the model that would be used for an agent
   */
  getModelForAgent(agentId: AgentId): string {
    const providerManager = getLLMProviderManager();
    return providerManager.getModelForAgent(agentId);
  }

  /**
   * Get the fallback chain for an agent
   */
  getFallbackChainForAgent(agentId: AgentId): string[] {
    const providerManager = getLLMProviderManager();
    return providerManager.getFallbackChain(agentId);
  }
}

// Singleton instance
let llmServiceInstance: LLMService | null = null;

/**
 * Get the singleton LLM service instance
 */
export function getLLMService(config?: LLMServiceConfig): LLMService {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService(config);
  }
  return llmServiceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetLLMService(): void {
  llmServiceInstance = null;
}
