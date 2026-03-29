import type { ILLMProvider, LLMMessage, LLMResponse, LLMProviderConfig } from './llm-provider.js';
import { LLMProviderError } from './llm-provider.js';
import type { IProtocolAdapter, EndpointCredentials } from './protocols/index.js';
import type { ProtocolRequestConfig } from './protocols/protocol-adapter.js';
import { getProtocolAdapter } from './protocols/index.js';
import type { EndpointConfig } from './endpoints/index.js';
import { resolveCredentials } from './endpoints/index.js';
import { ModelRouter, getModelRouter } from './routing/index.js';
import { getCachedConfig } from './provider-manager/config-loader.js';
import { resolveProviderRequestModel } from './provider-manager/model-resolution.js';
import { authManagerV2 } from '../../cli/lib/auth-manager-v2.js';
import { isPonyBunnyDebugEnabled } from '../config/debug-flags.js';
import type { ILogger } from '../observability/logger.js';
import { NoopLogger } from '../observability/logger.js';

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

interface RequestDebugMeta {
  model: string;
  endpointId: string;
  protocol: string;
  stream: boolean;
  toolChoice: string;
  toolCount: number;
  hasTools: boolean;
  stopCount: number;
  hasEmptyStop: boolean;
  responseFormatType: string;
  messageCount: number;
  roleCounts: Record<string, number>;
  maxTokens: number | null;
  temperature: number | null;
}

/**
 * Unified LLM Provider
 * Routes requests to appropriate protocol adapters and endpoints with automatic fallback
 */
export class UnifiedLLMProvider implements ILLMProvider {
  private router: ModelRouter;
  private config: UnifiedProviderConfig;
  private previousRequestMeta = new Map<string, RequestDebugMeta>();
  private requestCounter = 0;
  private readonly logger: ILogger;

  constructor(config: UnifiedProviderConfig = {}, logger: ILogger = new NoopLogger()) {
    this.router = config.router || getModelRouter();
    this.config = config;
    this.logger = logger;
  }

  async complete(
    messages: LLMMessage[],
    options?: Partial<LLMProviderConfig>
  ): Promise<LLMResponse> {
    const model = options?.model;
    if (!model) {
      throw new LLMProviderError('Model must be specified', 'unified-provider', false);
    }

    if (isPonyBunnyDebugEnabled()) this.logger.debug({ model }, '[UnifiedProvider] Received request for model');

    const protocol = this.router.getProtocolForModel(model);
    if (!protocol) {
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

    if (isPonyBunnyDebugEnabled()) this.logger.debug({ model, endpoints: endpoints.map(e => e.id) }, '[UnifiedProvider] Endpoints candidates');
    let lastError: Error | null = null;

    // Try endpoints in priority order with fallback
    for (const endpoint of endpoints) {
      try {
        const adapter = getProtocolAdapter(endpoint.protocol);
        const response = await this.callEndpoint(adapter, endpoint, messages, model, options);
        if (isPonyBunnyDebugEnabled()) this.logger.debug({ endpointId: endpoint.id }, '[UnifiedProvider] Success');
        return response;
      } catch (error) {
        lastError = error as Error;

        if (isPonyBunnyDebugEnabled()) this.logger.debug({ endpointId: endpoint.id, error: (error as Error).message }, '[UnifiedProvider] Failed call');

        // Log the failure
        this.logger.warn(
          { endpointId: endpoint.id, model },
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
    const requestId = ++this.requestCounter;
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
      accessToken: credentials.accessToken,
    };

    // Special handling for Codex OAuth
    if (adapter.protocolId === 'codex') {
      try {
        const token = await authManagerV2.getAccessToken();
        if (token) {
          endpointCreds.accessToken = token;
        } else {
          // If we can't get a token, we should probably warn or throw, 
          // but the adapter might have other ways to auth (unlikely for Codex)
          this.logger.warn({ endpointId: endpoint.id }, '[UnifiedProvider] No OAuth token available for Codex');
        }
      } catch (error) {
        this.logger.warn({ endpointId: endpoint.id, error: (error as Error).message }, '[UnifiedProvider] Failed to get Codex token');
      }
    }

    const llmConfig = getCachedConfig();
    const providerRequestModel = resolveProviderRequestModel(model, llmConfig);
    this.assertNoProviderPrefixLeak(providerRequestModel, llmConfig);

    // Build request
    const requestConfig: ProtocolRequestConfig = {
      model: providerRequestModel,
      maxTokens: options?.maxTokens || this.config.defaultMaxTokens || 4000,
      temperature: options?.temperature ?? 0.7,
      tools: options?.tools,
      modelNativeTools: options?.modelNativeTools,
      allowModelNativeTools: options?.allowModelNativeTools,
      tool_choice: options?.tool_choice,
      thinking: options?.thinking,
      stream: options?.stream,
      openaiOperation: options?.openaiOperation,
    };

    const requestBody = adapter.formatRequest(messages, requestConfig);

    this.logRequestMeta(adapter, endpoint, model, requestBody, messages, requestId);

    // Build URL and headers (prefer credentials file baseUrl override)
    const baseUrl = credentials.baseUrl || credentials.endpoint || endpoint.baseUrl;
    const url = adapter.buildUrl(baseUrl, providerRequestModel, endpointCreds, requestConfig);

    const baseUrlSource = credentials.baseUrl || credentials.endpoint
      ? 'credentials'
      : (endpoint.baseUrl ? 'config' : 'default');

    if (isPonyBunnyDebugEnabled()) this.logger.debug(
      { endpointId: endpoint.id, protocol: adapter.protocolId, baseUrl, baseUrlSource, url },
      '[UnifiedProvider] Attempting endpoint'
    );

    const headers = this.buildHeaders(adapter, endpoint, endpointCreds);
    if (adapter.protocolId === 'codex') {
      headers['Accept'] = 'text/event-stream';
    }

    // Make request
    const timeout = options?.timeout || this.config.defaultTimeout || 60000;

    // Handle streaming
    if ((options?.stream && adapter.supportsStreaming()) || adapter.protocolId === 'codex') {
      return await this.handleStreamingRequest(
        url,
        headers,
        requestBody,
        timeout,
        adapter,
        model,
        endpoint.id,
        requestId,
        options?.onChunk,
        requestConfig
      );
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });

      const data = await response.json().catch(() => ({ error: { message: response.statusText } }));

      // Debug log the raw response
      if (isPonyBunnyDebugEnabled()) this.logger.debug({ endpointId: endpoint.id }, `[UnifiedProvider] Raw response from ${endpoint.id}`);

      if (!response.ok) {
        const errorMessage = adapter.extractErrorMessage(data);
        const recoverable = adapter.isRecoverableError(response.status, data);

        throw new LLMProviderError(
          `${endpoint.displayName} API error: ${errorMessage}`,
          endpoint.id,
          recoverable
        );
      }

      const parsed = adapter.parseResponse(
        { status: response.status, statusText: response.statusText, data },
        model,
        requestConfig
      );

      this.logInboundMessage(parsed, requestId, endpoint.id);
      return parsed;
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
   * Handle streaming request
   */
  private async handleStreamingRequest(
    url: string,
    headers: Record<string, string>,
    requestBody: unknown,
    timeout: number,
    adapter: IProtocolAdapter,
    model: string,
    endpointId: string,
    requestId: number,
    onChunk?: (chunk: import('./llm-provider.js').StreamChunk) => void,
    _requestConfig?: ProtocolRequestConfig
  ): Promise<LLMResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: { message: response.statusText } }));
      const errorMessage = adapter.extractErrorMessage(data);
      const recoverable = adapter.isRecoverableError(response.status, data);

      throw new LLMProviderError(
        `Streaming API error: ${errorMessage}`,
        'unified-provider',
        recoverable
      );
    }

    if (!response.body) {
      throw new LLMProviderError(
        'No response body for streaming',
        'unified-provider',
        false
      );
    }

    // Accumulate response
    let fullContent = '';
    let fullThinking = '';
    const toolCalls: import('./llm-provider.js').ToolCall[] = [];
    let finishReason: 'stop' | 'length' | 'tool_calls' | 'error' = 'stop';
    let chunkIndex = 0;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const parsedChunk = adapter.parseStreamChunk(line, chunkIndex++);
          if (!parsedChunk) continue;

          // Accumulate content
          if (parsedChunk.content) {
            fullContent += parsedChunk.content;
          }

          // Accumulate thinking
          if (parsedChunk.thinking) {
            fullThinking += parsedChunk.thinking;
          }

          // Accumulate tool calls
          if (parsedChunk.toolCalls) {
            toolCalls.push(...parsedChunk.toolCalls);
          }

          // Call user callback
          if (onChunk) {
            onChunk(parsedChunk);
          }

          // Check if done
          if (parsedChunk.done) {
            finishReason = parsedChunk.finishReason || 'stop';
            break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const parsed: LLMResponse = {
      content: fullContent || null,
      tokensUsed: 0, // Token count not available in streaming
      model,
      finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: fullThinking || undefined,
    };

    this.logInboundMessage(parsed, requestId, endpointId);
    return parsed;
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
    const configuredModels = Object.keys(getCachedConfig().models);
    for (const modelId of configuredModels) {
      if (this.router.getEndpointsForModel(modelId).length > 0) {
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

  private logRequestMeta(
    adapter: IProtocolAdapter,
    endpoint: EndpointConfig,
    model: string,
    requestBody: unknown,
    messages: LLMMessage[],
    requestId: number
  ): void {
    const body = (requestBody && typeof requestBody === 'object')
      ? requestBody as Record<string, unknown>
      : {};

    const tools = Array.isArray(body.tools) ? body.tools : [];
    const stop = Array.isArray(body.stop) ? body.stop : [];
    const roleCounts: Record<string, number> = {};

    for (const message of messages) {
      roleCounts[message.role] = (roleCounts[message.role] || 0) + 1;
    }

    const meta: RequestDebugMeta = {
      model,
      endpointId: endpoint.id,
      protocol: adapter.protocolId,
      stream: Boolean(body.stream),
      toolChoice: typeof body.tool_choice === 'string'
        ? body.tool_choice
        : (body.tool_choice ? 'function' : 'unset'),
      toolCount: tools.length,
      hasTools: tools.length > 0,
      stopCount: stop.length,
      hasEmptyStop: stop.some(item => typeof item === 'string' && item.length === 0),
      responseFormatType: body.response_format && typeof body.response_format === 'object'
        ? String((body.response_format as Record<string, unknown>).type || 'object')
        : (body.response_format ? String(body.response_format) : 'unset'),
      messageCount: messages.length,
      roleCounts,
      maxTokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
      temperature: typeof body.temperature === 'number' ? body.temperature : null,
    };

    const key = `${endpoint.id}:${model}`;
    const previous = this.previousRequestMeta.get(key);
    const outboundMessages = messages.map((message) => ({
      role: message.role,
      content: message.content,
      tool_calls: message.tool_calls,
      tool_call_id: message.tool_call_id,
    }));

    if (isPonyBunnyDebugEnabled()) this.logger.debug({ requestId }, `[UnifiedProvider] Outbound messages`);
    if (isPonyBunnyDebugEnabled()) this.logger.debug({ requestId, ...meta }, `[UnifiedProvider] Request meta`);

    if (previous) {
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      const fields = Object.keys(meta) as Array<keyof RequestDebugMeta>;

      for (const field of fields) {
        const before = previous[field];
        const after = meta[field];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          diff[String(field)] = { from: before, to: after };
        }
      }

      if (Object.keys(diff).length > 0) {
        if (isPonyBunnyDebugEnabled()) this.logger.debug({ requestId }, `[UnifiedProvider] Request meta diff from previous call`);
      } else {
        if (isPonyBunnyDebugEnabled()) this.logger.debug({ requestId }, `[UnifiedProvider] Request meta unchanged from previous call.`);
      }
    }

    this.previousRequestMeta.set(key, meta);
  }

  private logInboundMessage(response: LLMResponse, requestId: number, endpointId: string): void {
    const inboundMessage = {
      role: 'assistant',
      content: response.content,
      tool_calls: response.toolCalls,
      finish_reason: response.finishReason,
      model: response.model,
      tokens_used: response.tokensUsed,
      thinking: response.thinking,
    };

    if (isPonyBunnyDebugEnabled()) this.logger.debug({ requestId, endpointId }, `[UnifiedProvider] Inbound parsed message`);
  }

  private assertNoProviderPrefixLeak(modelId: string, config: import('./provider-manager/types.js').LLMConfig): void {
    const dotIndex = modelId.indexOf('.');
    if (dotIndex <= 0 || dotIndex === modelId.length - 1) {
      return;
    }

    const prefix = modelId.slice(0, dotIndex);
    if (config.providers[prefix] || config.providerAliases?.[prefix]) {
      throw new LLMProviderError(
        `Provider-qualified model leaked to provider request payload: ${modelId}`,
        'unified-provider',
        false
      );
    }
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
