// Core types and interfaces
export type {
  ILLMProvider,
  LLMMessage,
  LLMResponse,
  LLMUsage,
  LLMProviderConfig,
} from './llm-provider.js';

export { LLMProviderError, LLMRouter, MockLLMProvider } from './llm-provider.js';

// Provider implementations (legacy, kept for backward compatibility)
export { OpenAIProvider, AnthropicProvider } from './providers.js';
export { GeminiProvider } from './gemini-provider.js';

// Account-based providers (OAuth)
export { CodexAccountProvider, AntigravityAccountProvider } from './account-providers.js';

// Provider registry (legacy, kept for backward compatibility)
export type {
  LLMProviderMetadata,
  LLMProviderFactory,
  ILLMProviderRegistry,
} from './provider-registry.js';
export { LLMProviderRegistry } from './provider-registry.js';

// Provider factory and metadata (legacy, kept for backward compatibility)
export {
  PROVIDER_METADATA,
  PROVIDER_FACTORIES,
  createProviderRegistry,
  getProviderRegistry,
  resetProviderRegistry,
  estimateModelCost,
  isModelSupported,
  getAllSupportedModels,
} from './provider-factory.js';

// Unified LLM Service
export type { TierModelConfig, LLMServiceConfig } from './llm-service.js';
export {
  LLMService,
  getLLMService,
  resetLLMService,
  DEFAULT_TIER_MODELS,
} from './llm-service.js';

// ============================================
// New Protocol-Endpoint Decoupling Architecture
// ============================================

// Protocol adapters
export type {
  ProtocolId,
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
  IProtocolAdapter,
} from './protocols/index.js';

export {
  BaseProtocolAdapter,
  AnthropicProtocolAdapter,
  OpenAIProtocolAdapter,
  GeminiProtocolAdapter,
  getProtocolAdapter,
  getAnthropicProtocol,
  getOpenAIProtocol,
  getGeminiProtocol,
} from './protocols/index.js';

// Endpoint configuration
export type {
  EndpointId,
  EndpointConfig,
  ResolvedEndpointCredentials,
} from './endpoints/index.js';

export {
  ENDPOINT_CONFIGS,
  getEndpointConfig,
  getAllEndpointConfigs,
  getAvailableEndpoints,
  getEndpointsByProtocol,
  hasRequiredCredentials,
  resolveCredentials,
} from './endpoints/index.js';

// Model routing
export type { ModelRoutingConfig } from './routing/index.js';

export {
  DEFAULT_ROUTING_CONFIG,
  loadEndpointPriorityOverrides,
  getRoutingConfig,
  ModelRouter,
  getModelRouter,
  resetModelRouter,
} from './routing/index.js';

// Unified provider
export type { UnifiedProviderConfig } from './unified-provider.js';

export {
  UnifiedLLMProvider,
  getUnifiedProvider,
  resetUnifiedProvider,
} from './unified-provider.js';

// ============================================
// New Provider Manager Architecture
// ============================================

// Provider Manager types
export type {
  ModelTier as ProviderModelTier,
  AgentId,
  LLMEndpointConfig as ProviderEndpointConfig,
  ModelCapability,
  LLMModelConfig as ProviderModelConfig,
  LLMTierConfig as ProviderTierConfig,
  LLMAgentConfig,
  LLMDefaultsConfig,
  LLMConfig,
  LLMCompletionOptions,
  ILLMProviderManager,
  EndpointHealth,
} from './provider-manager/index.js';

export { ConfigValidationError, ConfigNotFoundError } from './provider-manager/index.js';

// Config Loader
export {
  getConfigDir as getProviderConfigDir,
  getLLMConfigPath,
  getSchemaPath,
  DEFAULT_LLM_CONFIG,
  validateConfig,
  loadLLMConfig,
  saveLLMConfig,
  configFileExists,
  getCachedConfig,
  clearConfigCache,
  reloadConfig as reloadLLMConfig,
  getEndpointConfig as getProviderEndpointConfig,
  getModelConfig as getProviderModelConfig,
  getTierConfig as getProviderTierConfig,
  getAgentConfig as getProviderAgentConfig,
  getDefaultsConfig,
} from './provider-manager/index.js';

// Endpoint Manager
export {
  EndpointManager,
  getEndpointManager,
  resetEndpointManager,
} from './provider-manager/index.js';

// Agent Model Resolver
export {
  AgentModelResolver,
  getAgentModelResolver,
  resetAgentModelResolver,
} from './provider-manager/index.js';

// Provider Manager
export {
  LLMProviderManager,
  getLLMProviderManager,
  resetLLMProviderManager,
} from './provider-manager/index.js';
