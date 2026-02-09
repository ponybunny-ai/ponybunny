import type { LLMMessage, LLMResponse } from '../llm-provider.js';
import type { ProtocolId } from '../protocols/index.js';

/**
 * Model tier for complexity-based selection
 */
export type ModelTier = 'simple' | 'medium' | 'complex';

/**
 * Agent identifiers for agent-specific model configuration
 */
export type AgentId =
  | 'input-analysis'
  | 'planning'
  | 'execution'
  | 'verification'
  | 'response-generation'
  | 'conversation'
  | string; // Allow custom agent IDs

/**
 * Endpoint configuration in llm-config.json
 */
export interface LLMEndpointConfig {
  /** Whether this endpoint is enabled */
  enabled: boolean;
  /** Protocol used by this endpoint */
  protocol: ProtocolId;
  /** Base URL for API requests (optional, uses default if not specified) */
  baseUrl?: string;
  /** Priority for endpoint selection (lower = preferred) */
  priority: number;
  /** Rate limit configuration */
  rateLimit?: {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
  };
  /** AWS region for Bedrock */
  region?: string;
  /** Cost multiplier relative to direct API */
  costMultiplier?: number;
}

/**
 * Model capabilities
 */
export type ModelCapability = 'text' | 'vision' | 'function-calling' | 'json-mode';

/**
 * Model configuration in llm-config.json
 */
export interface LLMModelConfig {
  /** Human-readable display name */
  displayName: string;
  /** List of endpoint IDs that support this model */
  endpoints: string[];
  /** Cost per 1k tokens */
  costPer1kTokens: {
    input: number;
    output: number;
  };
  /** Maximum context window size */
  maxContextTokens?: number;
  /** Model capabilities */
  capabilities?: ModelCapability[];
}

/**
 * Tier configuration with primary model and fallback chain
 */
export interface LLMTierConfig {
  /** Primary model for this tier */
  primary: string;
  /** Fallback models in order of preference */
  fallback?: string[];
}

/**
 * Agent configuration for model selection
 */
export interface LLMAgentConfig {
  /** Tier to use for this agent (uses tier's primary/fallback) */
  tier?: ModelTier;
  /** Override primary model (takes precedence over tier) */
  primary?: string;
  /** Override fallback chain */
  fallback?: string[];
  /** Description of the agent's purpose */
  description?: string;
}

/**
 * Default configuration values
 */
export interface LLMDefaultsConfig {
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Default max tokens for responses */
  maxTokens?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelayMs?: number;
  /** Default temperature */
  temperature?: number;
}

/**
 * Complete LLM configuration structure
 */
export interface LLMConfig {
  /** JSON Schema reference */
  $schema?: string;
  /** Endpoint configurations */
  endpoints: Record<string, LLMEndpointConfig>;
  /** Model configurations */
  models: Record<string, LLMModelConfig>;
  /** Tier configurations */
  tiers: Record<ModelTier, LLMTierConfig>;
  /** Agent configurations */
  agents: Record<string, LLMAgentConfig>;
  /** Default values */
  defaults: LLMDefaultsConfig;
}

/**
 * Options for LLM completion requests
 */
export interface LLMCompletionOptions {
  /** Override model selection */
  model?: string;
  /** Maximum tokens for response */
  maxTokens?: number;
  /** Temperature for response generation */
  temperature?: number;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Enable streaming mode */
  stream?: boolean;
  /** Callback for streaming chunks */
  onChunk?: (chunk: string, index: number) => void;
  /** Callback for streaming completion */
  onComplete?: (response: LLMResponse) => void;
  /** Callback for streaming errors */
  onError?: (error: Error) => void;
  /** Goal ID for event routing */
  goalId?: string;
  /** Work item ID for event routing */
  workItemId?: string;
  /** Run ID for event routing */
  runId?: string;
  /** Additional provider-specific options */
  [key: string]: unknown;
}

/**
 * Interface for the LLM Provider Manager
 */
export interface ILLMProviderManager {
  // Configuration management
  /** Get the current configuration */
  getConfig(): LLMConfig;
  /** Reload configuration from file */
  reloadConfig(): Promise<void>;

  // Endpoint management
  /** Get all enabled endpoints */
  getEnabledEndpoints(): Array<{ id: string; config: LLMEndpointConfig }>;
  /** Check if an endpoint is available (has credentials and is healthy) */
  isEndpointAvailable(endpointId: string): Promise<boolean>;

  // Model management
  /** Get all configured models */
  getAvailableModels(): Array<{ id: string; config: LLMModelConfig }>;
  /** Get endpoints that support a specific model */
  getModelEndpoints(modelId: string): string[];

  // Agent model resolution
  /** Get the primary model for an agent */
  getModelForAgent(agentId: AgentId): string;
  /** Get the primary model for a tier */
  getModelForTier(tier: ModelTier): string;
  /** Get the complete fallback chain for an agent */
  getFallbackChain(agentId: AgentId): string[];

  // LLM completion
  /** Complete a request using agent-based model selection */
  complete(
    agentId: AgentId,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse>;

  /** Complete a request using a specific model */
  completeWithModel(
    modelId: string,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse>;

  /** Complete a request using tier-based model selection */
  completeWithTier(
    tier: ModelTier,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse>;
}

/**
 * Configuration validation error
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public errors: Array<{ path: string; message: string }>
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Configuration file not found error
 */
export class ConfigNotFoundError extends Error {
  constructor(public configPath: string) {
    super(`Configuration file not found: ${configPath}`);
    this.name = 'ConfigNotFoundError';
  }
}
