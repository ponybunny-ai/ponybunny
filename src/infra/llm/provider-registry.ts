import type { ILLMProvider, LLMProviderConfig } from './llm-provider.js';

/**
 * Metadata describing an LLM provider's capabilities and configuration
 */
export interface LLMProviderMetadata {
  /** Unique identifier: 'openai', 'anthropic', 'gemini' */
  id: string;
  /** Human-readable name */
  name: string;
  /** Authentication type */
  authType: 'api-key' | 'oauth';
  /** List of supported model IDs */
  supportedModels: string[];
  /** Model name prefixes for auto-routing: 'gpt-', 'claude-', 'gemini-' */
  modelPrefixes: string[];
  /** Cost per 1k tokens by model: { input, output } */
  costPer1kTokens: Record<string, { input: number; output: number }>;
  /** Default model for this provider */
  defaultModel: string;
  /** Environment variable key for API key */
  envVarKey?: string;
}

/**
 * Factory function to create provider instances
 */
export type LLMProviderFactory = (config: LLMProviderConfig) => ILLMProvider;

/**
 * Registry entry combining metadata and factory
 */
interface ProviderEntry {
  metadata: LLMProviderMetadata;
  factory: LLMProviderFactory;
  instance?: ILLMProvider;
}

/**
 * Interface for the LLM Provider Registry
 */
export interface ILLMProviderRegistry {
  register(metadata: LLMProviderMetadata, factory: LLMProviderFactory): void;
  getProvider(providerId: string): ILLMProvider | undefined;
  getProviderForModel(modelId: string): ILLMProvider | undefined;
  getMetadata(providerId: string): LLMProviderMetadata | undefined;
  getAllProviders(): ILLMProvider[];
  getAllMetadata(): LLMProviderMetadata[];
  getProviderIdForModel(modelId: string): string | undefined;
}

/**
 * Plugin-style registry for LLM providers
 * Allows dynamic registration and model-based routing
 */
export class LLMProviderRegistry implements ILLMProviderRegistry {
  private providers = new Map<string, ProviderEntry>();

  /**
   * Register a provider with its metadata and factory
   */
  register(metadata: LLMProviderMetadata, factory: LLMProviderFactory): void {
    this.providers.set(metadata.id, { metadata, factory });
  }

  /**
   * Get a provider instance by provider ID
   * Creates instance lazily using environment variables
   */
  getProvider(providerId: string): ILLMProvider | undefined {
    const entry = this.providers.get(providerId);
    if (!entry) return undefined;

    // Lazy instantiation
    if (!entry.instance) {
      const apiKey = entry.metadata.envVarKey
        ? process.env[entry.metadata.envVarKey]
        : undefined;

      if (!apiKey && entry.metadata.authType === 'api-key') {
        return undefined; // No API key available
      }

      entry.instance = entry.factory({
        apiKey: apiKey || '',
        model: entry.metadata.defaultModel,
      });
    }

    return entry.instance;
  }

  /**
   * Get provider for a specific model by matching prefixes
   */
  getProviderForModel(modelId: string): ILLMProvider | undefined {
    const providerId = this.getProviderIdForModel(modelId);
    if (!providerId) return undefined;
    return this.getProvider(providerId);
  }

  /**
   * Get provider ID for a model by matching prefixes
   */
  getProviderIdForModel(modelId: string): string | undefined {
    for (const [id, entry] of this.providers) {
      // Check exact model match first
      if (entry.metadata.supportedModels.includes(modelId)) {
        return id;
      }
      // Then check prefix match
      for (const prefix of entry.metadata.modelPrefixes) {
        if (modelId.startsWith(prefix)) {
          return id;
        }
      }
    }
    return undefined;
  }

  /**
   * Get metadata for a provider
   */
  getMetadata(providerId: string): LLMProviderMetadata | undefined {
    return this.providers.get(providerId)?.metadata;
  }

  /**
   * Get all available provider instances (those with valid API keys)
   */
  getAllProviders(): ILLMProvider[] {
    const result: ILLMProvider[] = [];
    for (const [id] of this.providers) {
      const provider = this.getProvider(id);
      if (provider) {
        result.push(provider);
      }
    }
    return result;
  }

  /**
   * Get all registered provider metadata
   */
  getAllMetadata(): LLMProviderMetadata[] {
    return Array.from(this.providers.values()).map(e => e.metadata);
  }

  /**
   * Check if a provider has a valid API key configured
   */
  hasApiKey(providerId: string): boolean {
    const entry = this.providers.get(providerId);
    if (!entry) return false;
    if (!entry.metadata.envVarKey) return false;
    return !!process.env[entry.metadata.envVarKey];
  }

  /**
   * Get list of provider IDs with valid API keys
   */
  getAvailableProviderIds(): string[] {
    return Array.from(this.providers.keys()).filter(id => this.hasApiKey(id));
  }
}
