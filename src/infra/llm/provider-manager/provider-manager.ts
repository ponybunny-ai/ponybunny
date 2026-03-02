import type {
  ILLMProviderManager,
  LLMConfig,
  LLMEndpointConfig,
  LLMModelConfig,
  WorkloadId,
  ModelTier,
  LLMCompletionOptions,
} from './types.js';
import type { LLMMessage, LLMResponse } from '../llm-provider.js';
import { LLMProviderError } from '../llm-provider.js';
import { getCachedConfig, reloadConfig, clearConfigCache } from './config-loader.js';
import { EndpointManager, getEndpointManager } from './endpoint-manager.js';
import { WorkloadModelResolver, getWorkloadModelResolver } from './agent-model-resolver.js';
import { getProtocolAdapter } from '../protocols/index.js';
import type { EndpointCredentials } from '../protocols/index.js';
import { gatewayEventBus } from '../../../gateway/events/event-bus.js';
import { isPonyBunnyDebugEnabled } from '../../config/debug-flags.js';
import { randomUUID } from 'crypto';
import type { OpenAIOperation, ProtocolRequestConfig } from '../protocols/protocol-adapter.js';
import { resolveProviderRequestModel as resolveProviderRequestModelId } from './model-resolution.js';

/**
 * LLM Provider Manager
 * Unified interface for LLM provider management with JSON configuration
 */
export class LLMProviderManager implements ILLMProviderManager {
  private endpointManager: EndpointManager;
  private workloadModelResolver: WorkloadModelResolver;
  private defaultTimeout: number;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor() {
    this.endpointManager = getEndpointManager();
    this.workloadModelResolver = getWorkloadModelResolver();

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
    if (Array.isArray(modelConfig?.providers) && modelConfig.providers.length > 0) {
      return modelConfig.providers;
    }

    const dotIndex = modelId.indexOf('.');
    if (dotIndex > 0 && dotIndex < modelId.length - 1) {
      return [modelId.slice(0, dotIndex)];
    }

    return [];
  }

  // ============================================
  // Agent Model Resolution
  // ============================================

  getModelForWorkload(workloadId: WorkloadId): string {
    return this.workloadModelResolver.getModelForWorkload(workloadId);
  }

  getModelForTier(tier: ModelTier): string {
    return this.workloadModelResolver.getModelForTier(tier);
  }

  getFallbackChain(workloadId: WorkloadId): string[] {
    return this.workloadModelResolver.getFallbackChain(workloadId);
  }

  // ============================================
  // LLM Completion
  // ============================================

  async complete(
    workloadId: WorkloadId,
    messages: LLMMessage[],
    options?: LLMCompletionOptions
  ): Promise<LLMResponse> {
    const fallbackChain = this.workloadModelResolver.getFallbackChain(workloadId);
    const operation = this.resolveOpenAIOperation(workloadId, options?.openaiOperation);
    return this.completeWithFallback(fallbackChain, messages, options, operation);
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
    const fallbackChain = this.workloadModelResolver.getFallbackChainForTier(tier);
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
    options?: LLMCompletionOptions,
    openaiOperation?: OpenAIOperation
  ): Promise<LLMResponse> {
    let lastError: Error | null = null;

    for (const modelId of modelChain) {
      const resolution = await this.resolveModelAndEndpoints(modelId);
      const endpoints = resolution.endpoints;
      const resolvedModelId = resolution.modelId;

      if (endpoints.length === 0) {
        console.warn(`[ProviderManager] No available endpoints for model: ${modelId}`);
        continue;
      }

      // Try each endpoint
      for (const endpointId of endpoints) {
        try {
          return await this.callEndpoint(
            endpointId,
            resolvedModelId,
            messages,
            options,
            openaiOperation
          );
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
    options?: LLMCompletionOptions,
    openaiOperation?: OpenAIOperation
  ): Promise<LLMResponse> {
    const config = getCachedConfig();
    const endpointConfig = config.providers[endpointId];

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
    const modelConfig = config.models[modelId];
    const selectedOpenAIEndpoint = this.resolveSupportedOpenAIEndpoint(
      endpointConfig.protocol,
      modelConfig,
      openaiOperation
    );
    const providerRequestModel = this.resolveProviderRequestModel(modelId, config);
    const maxTokens = this.resolveMaxTokens(options?.maxTokens, modelConfig);

    const requestConfig: ProtocolRequestConfig = {
      model: providerRequestModel,
      maxTokens,
      temperature: this.resolveTemperature(providerRequestModel, modelConfig, options?.temperature),
      tools: options?.tools,
      modelNativeTools: options?.modelNativeTools,
      allowModelNativeTools: options?.allowModelNativeTools,
      tool_choice: options?.tool_choice,
      thinking: options?.thinking,
      openaiOperation: selectedOpenAIEndpoint?.name,
      openaiEndpointUrl: selectedOpenAIEndpoint?.url,
    };

    const requestBody = adapter.formatRequest(messages, requestConfig);

    // Debug log the request body
    if (isPonyBunnyDebugEnabled()) {
      console.log(`[ProviderManager] Request to ${endpointId}:`, JSON.stringify(requestBody, null, 2));
    }

    // Add streaming to request body if enabled
    if (options?.stream && adapter.supportsStreaming()) {
      (requestBody as Record<string, unknown>).stream = true;
    }

    // Build URL and headers
    const baseUrl = credentials.baseUrl || endpointConfig.baseUrl || '';
    const url = adapter.buildUrl(baseUrl, providerRequestModel, endpointCreds, requestConfig);
    const headers = this.buildHeaders(adapter, endpointId, endpointCreds);

    // Debug log URL and headers
    if (isPonyBunnyDebugEnabled()) {
      console.log(`[ProviderManager] URL: ${url}`);
      console.log(`[ProviderManager] Headers:`, JSON.stringify(this.sanitizeHeadersForDebug(headers), null, 2));
    }

    // Make request
    const timeout = options?.timeout || this.defaultTimeout;

    try {
      // Check if streaming is enabled and supported
      if (options?.stream && adapter.supportsStreaming()) {
        return await this.callEndpointStreaming(
          url,
          headers,
          requestBody,
          timeout,
          adapter,
          modelId,
          endpointId,
          options,
          requestConfig
        );
      }

      // Non-streaming request
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });

      const data = await response.json().catch(() => ({ error: { message: response.statusText } }));

      // Debug log
      if (isPonyBunnyDebugEnabled()) {
        console.log(`[ProviderManager] Response from ${endpointId}:`, JSON.stringify(data, null, 2));
      }

      if (!response.ok) {
        const errorMessage = adapter.extractErrorMessage(data);
        const recoverable = adapter.isRecoverableError(response.status, data);

        throw new LLMProviderError(
          `${endpointId} API error: ${errorMessage}`,
          endpointId,
          recoverable
        );
      }

      const parsed = adapter.parseResponse(
        { status: response.status, statusText: response.statusText, data },
        modelId,
        requestConfig
      );

      parsed.endpointId = endpointId;
      return parsed;
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
   * Call endpoint with streaming support
   */
  private async callEndpointStreaming(
    url: string,
    headers: Record<string, string>,
    requestBody: unknown,
    timeout: number,
    adapter: ReturnType<typeof getProtocolAdapter>,
    modelId: string,
    endpointId: string,
    options: LLMCompletionOptions,
    _requestConfig: ProtocolRequestConfig
  ): Promise<LLMResponse> {
    const requestId = randomUUID();
    const startTime = Date.now();

    // Emit stream start event
    gatewayEventBus.emit('llm.stream.start', {
      requestId,
      goalId: options.goalId,
      workItemId: options.workItemId,
      runId: options.runId,
      model: modelId,
      timestamp: startTime,
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: { message: response.statusText } }));
        const errorMessage = adapter.extractErrorMessage(data);

        // Emit error event
        gatewayEventBus.emit('llm.stream.error', {
          requestId,
          goalId: options.goalId,
          error: errorMessage,
          timestamp: Date.now(),
        });

        throw new LLMProviderError(
          `${endpointId} API error: ${errorMessage}`,
          endpointId,
          adapter.isRecoverableError(response.status, data)
        );
      }

      // Process streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let chunkIndex = 0;
      let fullContent = '';
      let tokensUsed = 0;
      let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
      const accumulatedToolCalls: import('../llm-provider.js').ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const chunk = adapter.parseStreamChunk(line, chunkIndex);

          if (chunk) {
            if (chunk.content) {
              fullContent += chunk.content;

              // Emit chunk event
              gatewayEventBus.emit('llm.stream.chunk', {
                requestId,
                goalId: options.goalId,
                chunk: chunk.content,
                index: chunkIndex,
                timestamp: Date.now(),
              });

              // Call user callback
              if (options.onChunk) {
                options.onChunk(chunk.content, chunkIndex);
              }

              chunkIndex++;
            }

            // Accumulate tool calls emitted at stream end
            if (chunk.toolCalls) {
              accumulatedToolCalls.push(...chunk.toolCalls);
            }

            if (chunk.done) {
              finishReason = chunk.finishReason || 'stop';
              if (typeof chunk.tokensUsed === 'number' && Number.isFinite(chunk.tokensUsed)) {
                tokensUsed = chunk.tokensUsed;
              }
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const chunk = adapter.parseStreamChunk(buffer, chunkIndex);
        if (chunk) {
          if (chunk.content) {
            fullContent += chunk.content;
            gatewayEventBus.emit('llm.stream.chunk', {
              requestId,
              goalId: options.goalId,
              chunk: chunk.content,
              index: chunkIndex,
              timestamp: Date.now(),
            });
            if (options.onChunk) {
              options.onChunk(chunk.content, chunkIndex);
            }
          }
          if (chunk.toolCalls) {
            accumulatedToolCalls.push(...chunk.toolCalls);
          }
          if (chunk.done) {
            finishReason = chunk.finishReason || 'stop';
            if (typeof chunk.tokensUsed === 'number' && Number.isFinite(chunk.tokensUsed)) {
              tokensUsed = chunk.tokensUsed;
            }
          }
        }
      }

      // Emit stream end event
      gatewayEventBus.emit('llm.stream.end', {
        requestId,
        goalId: options.goalId,
        totalChunks: chunkIndex,
        tokensUsed,
        finishReason,
        timestamp: Date.now(),
      });

      const llmResponse: LLMResponse = {
        content: fullContent,
        tokensUsed,
        model: modelId,
        endpointId,
        finishReason,
        toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
      };

      // Call completion callback
      if (options.onComplete) {
        options.onComplete(llmResponse);
      }

      return llmResponse;
    } catch (error) {
      // Emit error event
      gatewayEventBus.emit('llm.stream.error', {
        requestId,
        goalId: options.goalId,
        error: (error as Error).message,
        timestamp: Date.now(),
      });

      // Call error callback
      if (options.onError) {
        options.onError(error as Error);
      }

      if (error instanceof LLMProviderError) {
        throw error;
      }

      throw new LLMProviderError(
        `${endpointId} streaming request failed: ${(error as Error).message}`,
        endpointId,
        true
      );
    }
  }

  private resolveOpenAIOperation(
    _workloadId: WorkloadId,
    explicit?: OpenAIOperation
  ): OpenAIOperation {
    if (explicit) {
      return explicit;
    }

    return 'responses';
  }

  private parseModelSelector(modelSelector: string): { providerId?: string; modelId: string } {
    const config = getCachedConfig();
    if (config.models[modelSelector]) {
      const dotIndex = modelSelector.indexOf('.');
      if (dotIndex > 0 && dotIndex < modelSelector.length - 1) {
        return {
          providerId: modelSelector.slice(0, dotIndex),
          modelId: modelSelector,
        };
      }
      return { modelId: modelSelector };
    }

    const dotIndex = modelSelector.indexOf('.');
    if (dotIndex <= 0 || dotIndex === modelSelector.length - 1) {
      return { modelId: modelSelector };
    }

    const providerId = modelSelector.slice(0, dotIndex);
    const modelSuffix = modelSelector.slice(dotIndex + 1);

    const directModelId = `${providerId}.${modelSuffix}`;
    if (config.models[directModelId]) {
      return { providerId, modelId: directModelId };
    }

    const providerAliasConfig = config.providerAliases?.[providerId];
    if (!providerAliasConfig) {
      return { modelId: modelSelector };
    }

    if (!config.models[modelSuffix]) {
      return { modelId: modelSelector };
    }

    return { providerId, modelId: modelSuffix };
  }

  private async resolveModelAndEndpoints(
    modelSelector: string
  ): Promise<{ modelId: string; providerId?: string; endpoints: string[] }> {
    const config = getCachedConfig();
    const { providerId, modelId } = this.parseModelSelector(modelSelector);

    if (!providerId) {
      const endpoints = await this.endpointManager.getAvailableEndpointsForModel(modelId);
      return { modelId, endpoints };
    }

    const providerAliasConfig = config.providerAliases?.[providerId];
    if (!providerAliasConfig) {
      const endpoints = await this.endpointManager.getAvailableEndpointsForModel(modelId);
      return { modelId, endpoints };
    }

    const modelConfig = config.models[modelId];
    if (!modelConfig) {
      return { modelId, providerId, endpoints: [] };
    }

    const allowed = new Set(providerAliasConfig.providers);
    const explicitProviders = Array.isArray(modelConfig.providers)
      ? modelConfig.providers
      : [];
    const inferredProvider = providerId || modelId.split('.')[0];
    const scopedBase = explicitProviders.length > 0
      ? explicitProviders
      : (inferredProvider ? [inferredProvider] : []);
    const scoped = scopedBase.filter(endpointId => allowed.has(endpointId));

    const endpoints: string[] = [];
    for (const endpointId of scoped) {
      if (await this.endpointManager.isEndpointAvailable(endpointId)) {
        endpoints.push(endpointId);
      }
    }

    endpoints.sort((a, b) => {
      const priorityA = config.providers[a]?.priority ?? 999;
      const priorityB = config.providers[b]?.priority ?? 999;
      return priorityA - priorityB;
    });

    return { modelId, providerId, endpoints };
  }

  private resolveSupportedOpenAIEndpoint(
    protocol: string,
    modelConfig: LLMModelConfig | undefined,
    preferred: OpenAIOperation | undefined
  ): { name: OpenAIOperation; url: string } | undefined {
    if (protocol !== 'openai') {
      return undefined;
    }

    const fallbackName: OpenAIOperation = preferred ?? 'responses';
    const endpoints = (modelConfig?.endpoints ?? []).filter(
      item => item.name === 'responses'
    ) as Array<{ name: OpenAIOperation; url: string }>;
    if (!endpoints || endpoints.length === 0) {
      return {
        name: fallbackName,
        url: '/v1/responses',
      };
    }

    const preferredEndpoint = endpoints.find(item => item.name === fallbackName);
    if (preferredEndpoint) {
      return preferredEndpoint;
    }

    return endpoints[0];
  }

  private resolveMaxTokens(explicit: number | undefined, modelConfig: LLMModelConfig | undefined): number {
    const requested = explicit ?? this.defaultMaxTokens;
    const modelMax = modelConfig?.maxOutputTokens;

    if (!modelMax || modelMax <= 0) {
      return requested;
    }

    return Math.min(requested, modelMax);
  }

  private resolveTemperature(
    requestModel: string,
    modelConfig: LLMModelConfig | undefined,
    explicit: number | undefined
  ): number | undefined {
    if (this.isParamDisallowed(modelConfig, 'temperature')) {
      return undefined;
    }

    if (requestModel.toLowerCase().startsWith('gpt-5')) {
      return undefined;
    }

    return explicit ?? this.defaultTemperature;
  }

  private isParamDisallowed(modelConfig: LLMModelConfig | undefined, paramName: string): boolean {
    return Array.isArray(modelConfig?.disallowedParams) && modelConfig.disallowedParams.includes(paramName);
  }

  private resolveProviderRequestModel(modelId: string, config: LLMConfig): string {
    return resolveProviderRequestModelId(modelId, config);
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

  private sanitizeHeadersForDebug(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = { ...headers };
    for (const key of Object.keys(sanitized)) {
      const normalized = key.toLowerCase();
      if (normalized === 'authorization' || normalized === 'api-key' || normalized === 'x-api-key') {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Estimate cost for a completion
   */
  estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    return this.workloadModelResolver.estimateCost(modelId, inputTokens, outputTokens);
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
  getAllWorkloadIds(): string[] {
    return this.workloadModelResolver.getAllWorkloadIds();
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
