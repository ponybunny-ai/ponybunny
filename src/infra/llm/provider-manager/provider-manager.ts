import type {
  ILLMProviderManager,
  LLMConfig,
  LLMEndpointConfig,
  LLMModelConfig,
  AgentId,
  ModelTier,
  LLMCompletionOptions,
} from './types.js';
import type { LLMMessage, LLMResponse } from '../llm-provider.js';
import { LLMProviderError } from '../llm-provider.js';
import { getCachedConfig, reloadConfig, clearConfigCache } from './config-loader.js';
import { EndpointManager, getEndpointManager } from './endpoint-manager.js';
import { AgentModelResolver, getAgentModelResolver } from './agent-model-resolver.js';
import { getProtocolAdapter } from '../protocols/index.js';
import type { EndpointCredentials } from '../protocols/index.js';

/**
 * LLM Provider Manager
 * Unified interface for LLM provider management with JSON configuration
 */
export class LLMProviderManager implements ILLMProviderManager {
  private endpointManager: EndpointManager;
  private agentModelResolver: AgentModelResolver;
  private defaultTimeout: number;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor() {
    this.endpointManager = getEndpointManager();
    this.agentModelResolver = getAgentModelResolver();

    const config = getCachedConfig();
    this.defaultTimeout = config.defaults.timeout || 120000;
    this.defaultMaxTokens = config.defaults.maxTokens || 4096;
    this.defaultTemperature = config.defaults.temperature || 0.7;
  }

  // ============================================
  // Configuration Management
  // ============================================

  getConfig(): LLMConfig {
    return getCachedConfig();
  }

  async reloadConfig(): Promise<void> {
    clearConfigCache();
    this.endpointManager.clearHealthCache();
    reloadConfig();

    // Update defaults
    const config = getCachedConfig();
    this.defaultTimeout = config.defaults.timeout || 120000;
    this.defaultMaxTokens = config.defaults.maxTokens || 4096;
    this.defaultTemperature = config.defaults.temperature || 0.7;
  }

  // ============================================
  // Endpoint Management
  // ============================================

  getEnabledEndpoints(): Array<{ id: string; config: LLMEndpointConfig }> {
    return this.endpointManager.getEnabledEndpoints();
  }

  async isEndpointAvailable(endpointId: string): Promise<boolean> {
    return this.endpointManager.isEndpointAvailable(endpointId);
  }

  // ============================================
  // Model Management
  // ============================================

  getAvailableModels(): Array<{ id: string; config: LLMModelConfig }> {
    const config = getCachedConfig();
    return Object.entries(config.models).map(([id, modelConfig]) => ({
      id,
      config: modelConfig,
    }));
  }

  getModelEndpoints(modelId: string): string[] {
    const config = getCachedConfig();
    const modelConfig = config.models[modelId];
    return modelConfig?.endpoints || [];
  }

  // ============================================
  // Agent Model Resolution
  // ============================================

  getModelForAgent(agentId: AgentId): string {
    return this.agentModelResolver.getModelForAgent(agentId);
  }

  getModelForTier(tier: ModelTier): string {
    return this.agentModelResolver.getModelForTier(tier);
  }

  getFallbackChain(agentId: AgentId): string[] {
    return this.agentModelResolver.getFallbackChain(agentId);
  }

  // ============================================
  // LLM Completion
  // ============================================

  async complete(
    agentId: AgentId,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse> {
    const fallbackChain = this.agentModelResolver.getFallbackChain(agentId);
    return this.completeWithFallback(fallbackChain, messages, options);
  }

  async completeWithModel(
    modelId: string,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse> {
    return this.completeWithFallback([modelId], messages, options);
  }

  async completeWithTier(
    tier: ModelTier,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse> {
    const fallbackChain = this.agentModelResolver.getFallbackChainForTier(tier);
    return this.completeWithFallback(fallbackChain, messages, options);
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Complete a request with model fallback
   */
  private async completeWithFallback(
    modelChain: string[],
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse> {
    let lastError: Error | null = null;

    for (const modelId of modelChain) {
      // Get available endpoints for this model
      const endpoints = await this.endpointManager.getAvailableEndpointsForModel(modelId);

      if (endpoints.length === 0) {
        console.warn(`[ProviderManager] No available endpoints for model: ${modelId}`);
        continue;
      }

      // Try each endpoint
      for (const endpointId of endpoints) {
        try {
          return await this.callEndpoint(endpointId, modelId, messages, options);
        } catch (error) {
          lastError = error as Error;
          console.warn(
            `[ProviderManager] Endpoint ${endpointId} failed for ${modelId}: ${(error as Error).message}`
          );

          // Mark endpoint as failed
          this.endpointManager.markEndpointFailed(endpointId, (error as Error).message);

          // Check if error is non-recoverable
          if (error instanceof LLMProviderError && !error.recoverable) {
            throw error;
          }
        }
      }
    }

    throw new LLMProviderError(
      `All models and endpoints failed. Last error: ${lastError?.message || 'Unknown'}`,
      'provider-manager',
      false
    );
  }

  /**
   * Call a specific endpoint with a model
   */
  private async callEndpoint(
    endpointId: string,
    modelId: string,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse> {
    const config = getCachedConfig();
    const endpointConfig = config.endpoints[endpointId];

    if (!endpointConfig) {
      throw new LLMProviderError(`Unknown endpoint: ${endpointId}`, endpointId, false);
    }

    // Get protocol adapter
    const adapter = getProtocolAdapter(endpointConfig.protocol);

    // Resolve credentials
    const credentials = this.endpointManager.resolveCredentials(endpointId);
    if (!credentials) {
      throw new LLMProviderError(`Missing credentials for endpoint: ${endpointId}`, endpointId, true);
    }

    // Convert to EndpointCredentials format
    const endpointCreds: EndpointCredentials = {
      apiKey: credentials.apiKey,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      region: credentials.region,
      projectId: credentials.projectId,
    };

    // Build request
    const requestBody = adapter.formatRequest(messages, {
      model: modelId,
      maxTokens: options?.maxTokens || this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
    });

    // Build URL and headers
    const baseUrl = credentials.baseUrl || endpointConfig.baseUrl || '';
    const url = adapter.buildUrl(baseUrl, modelId, endpointCreds);
    const headers = this.buildHeaders(adapter, endpointId, endpointCreds);

    // Make request
    const timeout = options?.timeout || this.defaultTimeout;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });

      const data = await response.json().catch(() => ({ error: { message: response.statusText } }));

      // Debug log
      console.log(`[ProviderManager] Response from ${endpointId}:`, JSON.stringify(data, null, 2));

      if (!response.ok) {
        const errorMessage = adapter.extractErrorMessage(data);
        const recoverable = adapter.isRecoverableError(response.status, data);

        throw new LLMProviderError(
          `${endpointId} API error: ${errorMessage}`,
          endpointId,
          recoverable
        );
      }

      return adapter.parseResponse(
        { status: response.status, statusText: response.statusText, data },
        modelId
      );
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }

      throw new LLMProviderError(
        `${endpointId} request failed: ${(error as Error).message}`,
        endpointId,
        true
      );
    }
  }

  /**
   * Build headers for the request
   */
  private buildHeaders(
    adapter: ReturnType<typeof getProtocolAdapter>,
    endpointId: string,
    credentials: EndpointCredentials
  ): Record<string, string> {
    // Azure OpenAI uses different auth header
    if (endpointId === 'azure-openai') {
      return {
        'Content-Type': 'application/json',
        'api-key': credentials.apiKey || '',
      };
    }

    return adapter.buildHeaders(credentials);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Estimate cost for a completion
   */
  estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    return this.agentModelResolver.estimateCost(modelId, inputTokens, outputTokens);
  }

  /**
   * Get model configuration
   */
  getModelConfig(modelId: string): LLMModelConfig | undefined {
    const config = getCachedConfig();
    return config.models[modelId];
  }

  /**
   * Check if a model is supported
   */
  isModelSupported(modelId: string): boolean {
    const config = getCachedConfig();
    return modelId in config.models;
  }

  /**
   * Get all configured agent IDs
   */
  getAllAgentIds(): string[] {
    return this.agentModelResolver.getAllAgentIds();
  }
}

// Singleton instance
let instance: LLMProviderManager | null = null;

/**
 * Get the singleton LLMProviderManager instance
 */
export function getLLMProviderManager(): LLMProviderManager {
  if (!instance) {
    instance = new LLMProviderManager();
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetLLMProviderManager(): void {
  instance = null;
}
