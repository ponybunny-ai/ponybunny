import type { ILLMProvider, LLMMessage, LLMResponse, LLMProviderConfig } from './llm-provider.js';
import { LLMProviderError } from './llm-provider.js';
import type { IProtocolAdapter, EndpointCredentials } from './protocols/index.js';
import { getProtocolAdapter } from './protocols/index.js';
import type { EndpointConfig } from './endpoints/index.js';
import { resolveCredentials } from './endpoints/index.js';
import { ModelRouter, getModelRouter } from './routing/index.js';

/**
 * Configuration for UnifiedLLMProvider
 */
export interface UnifiedProviderConfig {
  /** Custom model router (uses default if not provided) */
  router?: ModelRouter;
  /** Default timeout in ms */
  defaultTimeout?: number;
  /** Default max tokens */
  defaultMaxTokens?: number;
}

/**
 * Unified LLM Provider
 * Routes requests to appropriate protocol adapters and endpoints with automatic fallback
 */
export class UnifiedLLMProvider implements ILLMProvider {
  private router: ModelRouter;
  private config: UnifiedProviderConfig;

  constructor(config: UnifiedProviderConfig = {}) {
    this.router = config.router || getModelRouter();
    this.config = config;
  }

  async complete(
    messages: LLMMessage[],
    options?: Partial<LLMProviderConfig>
  ): Promise<LLMResponse> {
    const model = options?.model;
    if (!model) {
      throw new LLMProviderError('Model must be specified', 'unified-provider', false);
    }

    const protocolId = this.router.getProtocolForModel(model);
    if (!protocolId) {
      throw new LLMProviderError(
        `No protocol found for model: ${model}`,
        'unified-provider',
        false
      );
    }

    const endpoints = this.router.getEndpointsForModel(model);
    if (endpoints.length === 0) {
      throw new LLMProviderError(
        `No available endpoints for model: ${model}`,
        'unified-provider',
        false
      );
    }

    const adapter = getProtocolAdapter(protocolId);
    let lastError: Error | null = null;

    // Try endpoints in priority order with fallback
    for (const endpoint of endpoints) {
      try {
        return await this.callEndpoint(adapter, endpoint, messages, model, options);
      } catch (error) {
        lastError = error as Error;

        // Log the failure
        console.warn(
          `[UnifiedProvider] Endpoint ${endpoint.id} failed for ${model}: ${(error as Error).message}`
        );

        // Check if error is recoverable
        if (error instanceof LLMProviderError && !error.recoverable) {
          throw error;
        }

        // Continue to next endpoint
      }
    }

    throw new LLMProviderError(
      `All endpoints failed for model ${model}. Last error: ${lastError?.message || 'Unknown'}`,
      'unified-provider',
      false
    );
  }

  /**
   * Call a specific endpoint with the protocol adapter
   */
  private async callEndpoint(
    adapter: IProtocolAdapter,
    endpoint: EndpointConfig,
    messages: LLMMessage[],
    model: string,
    options?: Partial<LLMProviderConfig>
  ): Promise<LLMResponse> {
    const credentials = resolveCredentials(endpoint);
    if (!credentials) {
      throw new LLMProviderError(
        `Missing credentials for endpoint: ${endpoint.id}`,
        endpoint.id,
        true
      );
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
      model,
      maxTokens: options?.maxTokens || this.config.defaultMaxTokens || 4000,
      temperature: options?.temperature ?? 0.7,
    });

    // Build URL and headers (prefer credentials file baseUrl override)
    const baseUrl = credentials.baseUrl || credentials.endpoint || endpoint.baseUrl;
    const url = adapter.buildUrl(baseUrl, model, endpointCreds);
    const headers = this.buildHeaders(adapter, endpoint, endpointCreds);

    // Make request
    const timeout = options?.timeout || this.config.defaultTimeout || 60000;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });

      const data = await response.json().catch(() => ({ error: { message: response.statusText } }));

      // Debug log the raw response
      console.log(`[UnifiedProvider] Raw response from ${endpoint.id}:`, JSON.stringify(data, null, 2));

      if (!response.ok) {
        const errorMessage = adapter.extractErrorMessage(data);
        const recoverable = adapter.isRecoverableError(response.status, data);

        throw new LLMProviderError(
          `${endpoint.displayName} API error: ${errorMessage}`,
          endpoint.id,
          recoverable
        );
      }

      return adapter.parseResponse(
        { status: response.status, statusText: response.statusText, data },
        model
      );
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }

      throw new LLMProviderError(
        `${endpoint.displayName} request failed: ${(error as Error).message}`,
        endpoint.id,
        true
      );
    }
  }

  /**
   * Build headers for the request, handling endpoint-specific variations
   */
  private buildHeaders(
    adapter: IProtocolAdapter,
    endpoint: EndpointConfig,
    credentials: EndpointCredentials
  ): Record<string, string> {
    // Azure OpenAI uses different auth header
    if (endpoint.id === 'azure-openai') {
      return {
        'Content-Type': 'application/json',
        'api-key': credentials.apiKey || '',
      };
    }

    return adapter.buildHeaders(credentials);
  }

  getName(): string {
    return 'unified-provider';
  }

  async isAvailable(): Promise<boolean> {
    // Check if any endpoint is available for any supported model pattern
    const patterns = this.router.getSupportedPatterns();
    for (const pattern of patterns) {
      // Use a sample model for each pattern
      const sampleModel = pattern.replace('*', 'test');
      if (this.router.getEndpointsForModel(sampleModel).length > 0) {
        return true;
      }
    }
    return false;
  }

  estimateCost(tokens: number): number {
    // Default estimation - actual cost depends on model
    return (tokens / 1000) * 0.01;
  }

  /**
   * Get the model router
   */
  getRouter(): ModelRouter {
    return this.router;
  }
}

/**
 * Singleton instance
 */
let instance: UnifiedLLMProvider | null = null;

export function getUnifiedProvider(config?: UnifiedProviderConfig): UnifiedLLMProvider {
  if (!instance) {
    instance = new UnifiedLLMProvider(config);
  }
  return instance;
}

export function resetUnifiedProvider(): void {
  instance = null;
}
