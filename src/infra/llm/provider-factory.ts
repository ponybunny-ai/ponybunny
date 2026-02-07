import type { LLMProviderMetadata, LLMProviderFactory } from './provider-registry.js';
import { LLMProviderRegistry } from './provider-registry.js';
import { OpenAIProvider, AnthropicProvider } from './providers.js';
import { GeminiProvider } from './gemini-provider.js';

/**
 * Provider metadata definitions for all supported LLM providers
 */
export const PROVIDER_METADATA: Record<string, LLMProviderMetadata> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    authType: 'api-key',
    supportedModels: [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ],
    modelPrefixes: ['claude-'],
    costPer1kTokens: {
      'claude-opus-4-5': { input: 0.015, output: 0.075 },
      'claude-sonnet-4-5': { input: 0.003, output: 0.015 },
      'claude-haiku-4-5': { input: 0.001, output: 0.005 },
      'claude-opus-4-5-20251101': { input: 0.015, output: 0.075 },
      'claude-sonnet-4-5-20250929': { input: 0.003, output: 0.015 },
      'claude-haiku-4-5-20250514': { input: 0.0008, output: 0.004 },
      'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
      'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
      'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
      'claude-3-sonnet-20240229': { input: 0.003, output: 0.015 },
      'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
    },
    defaultModel: 'claude-opus-4-5',
    envVarKey: 'ANTHROPIC_API_KEY',
  },

  openai: {
    id: 'openai',
    name: 'OpenAI',
    authType: 'api-key',
    supportedModels: [
      'gpt-5.2',
      'gpt-5.2-codex',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1',
      'o1-mini',
      'o1-preview',
    ],
    modelPrefixes: ['gpt-', 'o1'],
    costPer1kTokens: {
      'gpt-5.2': { input: 0.01, output: 0.03 },
      'gpt-5.2-codex': { input: 0.01, output: 0.03 },
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'o1': { input: 0.015, output: 0.06 },
      'o1-mini': { input: 0.003, output: 0.012 },
      'o1-preview': { input: 0.015, output: 0.06 },
    },
    defaultModel: 'gpt-5.2',
    envVarKey: 'OPENAI_API_KEY',
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    authType: 'api-key',
    supportedModels: [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
    ],
    modelPrefixes: ['gemini-'],
    costPer1kTokens: {
      'gemini-2.5-pro': { input: 0.00125, output: 0.005 },
      'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
      'gemini-2.0-flash': { input: 0.0001, output: 0.0004 },
      'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
      'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
    },
    defaultModel: 'gemini-2.0-flash',
    envVarKey: 'GEMINI_API_KEY',
  },
};

/**
 * Provider factory functions
 */
export const PROVIDER_FACTORIES: Record<string, LLMProviderFactory> = {
  anthropic: (config) => new AnthropicProvider(config),
  openai: (config) => new OpenAIProvider(config),
  gemini: (config) => new GeminiProvider(config),
};

/**
 * Create and initialize a provider registry with all built-in providers
 */
export function createProviderRegistry(): LLMProviderRegistry {
  const registry = new LLMProviderRegistry();

  // Register all providers
  for (const [id, metadata] of Object.entries(PROVIDER_METADATA)) {
    const factory = PROVIDER_FACTORIES[id];
    if (factory) {
      registry.register(metadata, factory);
    }
  }

  return registry;
}

/**
 * Get the default provider registry (singleton)
 */
let defaultRegistry: LLMProviderRegistry | null = null;

export function getProviderRegistry(): LLMProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createProviderRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default registry (useful for testing)
 */
export function resetProviderRegistry(): void {
  defaultRegistry = null;
}

/**
 * Get cost estimate for a specific model and token count
 */
export function estimateModelCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  for (const metadata of Object.values(PROVIDER_METADATA)) {
    const costs = metadata.costPer1kTokens[modelId];
    if (costs) {
      return (inputTokens / 1000) * costs.input + (outputTokens / 1000) * costs.output;
    }
  }
  // Default fallback cost
  return ((inputTokens + outputTokens) / 1000) * 0.01;
}

/**
 * Check if a model is supported by any provider
 */
export function isModelSupported(modelId: string): boolean {
  for (const metadata of Object.values(PROVIDER_METADATA)) {
    if (metadata.supportedModels.includes(modelId)) {
      return true;
    }
    for (const prefix of metadata.modelPrefixes) {
      if (modelId.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get all supported models across all providers
 */
export function getAllSupportedModels(): string[] {
  const models: string[] = [];
  for (const metadata of Object.values(PROVIDER_METADATA)) {
    models.push(...metadata.supportedModels);
  }
  return models;
}
