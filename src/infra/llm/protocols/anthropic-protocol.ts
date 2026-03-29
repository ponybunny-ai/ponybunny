import type { LLMMessage, LLMResponse, ToolCall, StreamChunk } from '../llm-provider.js';
import type { LLMErrorCode } from '../llm-error.js';
import type {
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
} from './protocol-adapter.js';
import { BaseProtocolAdapter } from './protocol-adapter.js';
import type { ILogger } from '../../observability/logger.js';
import { NoopLogger } from '../../observability/logger.js';

/**
 * Anthropic Messages API protocol adapter
 * Supports both Anthropic Direct and AWS Bedrock endpoints
 */
export class AnthropicProtocolAdapter extends BaseProtocolAdapter {
  readonly protocolId = 'anthropic' as const;

  // Streaming tool_calls accumulator state
  private streamingToolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  private readonly logger: ILogger;

  constructor(logger: ILogger = new NoopLogger()) {
    super();
    this.logger = logger;
  }

  /**
   * Reset streaming state (call before each new stream)
   */
  resetStreamState(): void {
    this.streamingToolCalls.clear();
  }

  formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown {
    // Extract system message separately (Anthropic API requirement)
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Convert messages to Anthropic format
    const anthropicMessages = conversationMessages.map(m => {
      // Handle tool result messages
      if (m.role === 'tool' && m.tool_call_id) {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.tool_call_id,
              content: m.content || '',
            },
          ],
        };
      }

      // Handle assistant messages with tool calls
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];

        // Add text content if present
        if (m.content) {
          content.push({
            type: 'text',
            text: m.content,
          });
        }

        // Add tool calls
        for (const toolCall of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments),
          });
        }

        return {
          role: 'assistant',
          content,
        };
      }

      // Regular messages
      return {
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || '',
      };
    });

    const requestBody: Record<string, unknown> = {
      model: config.model,
      messages: anthropicMessages,
      system: systemMessage?.content,
      max_tokens: config.maxTokens || 4000,
      temperature: config.temperature ?? 0.7,
    };

    // Add tools if provided
    if (config.tools && config.tools.length > 0) {
      requestBody.tools = config.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    // Add tool_choice if specified
    if (config.tool_choice) {
      if (config.tool_choice === 'required') {
        requestBody.tool_choice = { type: 'any' };
      } else if (config.tool_choice === 'auto' || config.tool_choice === 'none') {
        requestBody.tool_choice = { type: config.tool_choice };
      } else {
        requestBody.tool_choice = {
          type: 'tool',
          name: config.tool_choice.function.name,
        };
      }
    }

    // Add thinking (extended thinking) if enabled
    if (config.thinking) {
      requestBody.thinking = {
        type: 'enabled',
        budget_tokens: 10000,
      };
    }

    // Add streaming if enabled
    if (config.stream) {
      requestBody.stream = true;
    }

    return requestBody;
  }

  parseResponse(response: RawApiResponse, model: string): LLMResponse {
    const data = response.data as {
      content?: Array<{
        type: string;
        text?: string;
        thinking?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      usage?: { input_tokens: number; output_tokens: number };
      model?: string;
      stop_reason?: string;
    };

    // Extract content blocks
    let content = '';
    let thinking = '';
    const toolCalls: ToolCall[] = [];

    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          content += block.text;
        } else if (block.type === 'thinking' && block.thinking) {
          thinking += block.thinking;
        } else if (block.type === 'tool_use' && block.id && block.name) {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {}),
            },
          });
        }
      }
    }

    // Calculate tokens
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    const tokensUsed = inputTokens + outputTokens;

    return {
      content,
      tokensUsed,
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: tokensUsed,
      },
      model: data.model || model,
      finishReason: this.mapAnthropicFinishReason(data.stop_reason),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking || undefined,
    };
  }

  buildHeaders(credentials: EndpointCredentials): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (credentials.apiKey) {
      headers['x-api-key'] = credentials.apiKey;
    }

    return headers;
  }

  classifyError(status: number, response?: unknown): LLMErrorCode {
    // Anthropic-specific error classification using response body
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      const error = resp.error as Record<string, unknown> | undefined;
      const errorType = error?.type as string | undefined;

      if (errorType === 'invalid_request_error') {
        const msg = String(error?.message ?? '').toLowerCase();
        if (msg.includes('context') || msg.includes('token')) return 'context_exceeded';
        if (msg.includes('content') || msg.includes('safety')) return 'content_policy';
      }
      if (errorType === 'authentication_error') return 'auth_failed';
      if (errorType === 'permission_error') return 'auth_failed';
      if (errorType === 'not_found_error') return 'model_unavailable';
      if (errorType === 'rate_limit_error') return 'rate_limited';
      if (errorType === 'overloaded_error') return 'server_error';
    }
    return super.classifyError(status, response);
  }

  isRecoverableError(status: number, _response?: unknown): boolean {
    // 429 = rate limit, not recoverable on same endpoint
    // 5xx = server errors, potentially recoverable with fallback
    return status !== 429;
  }

  extractErrorMessage(response: unknown): string {
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      if (resp.error && typeof resp.error === 'object') {
        const error = resp.error as Record<string, unknown>;
        if (typeof error.message === 'string') {
          return error.message;
        }
      }
    }
    return super.extractErrorMessage(response);
  }

  supportsStreaming(): boolean {
    return true;
  }

  parseStreamChunk(line: string, _chunkIndex: number): StreamChunk | null {
    // Skip empty lines and comments
    if (!line.trim() || line.startsWith(':')) {
      return null;
    }

    // Parse SSE format: "event: message_start", "data: {...}"
    if (line.startsWith('event:')) {
      // Store event type for next data line (not implemented here, would need state)
      return null;
    }

    if (line.startsWith('data:')) {
      const jsonStr = line.slice(5).trim();

      // Check for stream end marker
      if (jsonStr === '[DONE]') {
        return {
          done: true,
          finishReason: 'stop',
        };
      }

      try {
        const data = JSON.parse(jsonStr) as {
          type?: string;
          index?: number;
          delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
          content_block?: {
            type?: string;
            text?: string;
            id?: string;
            name?: string;
          };
          message?: {
            stop_reason?: string;
            usage?: { input_tokens: number; output_tokens: number }
          };
        };

        // Handle content_block_start for tool_use — initialize accumulator
        if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
          const index = data.index ?? this.streamingToolCalls.size;
          this.streamingToolCalls.set(index, {
            id: data.content_block.id || '',
            name: data.content_block.name || '',
            arguments: '',
          });
          return null;
        }

        // Handle content_block_delta for text
        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          return {
            content: data.delta.text || '',
            done: false,
          };
        }

        // Handle content_block_delta for thinking
        if (data.type === 'content_block_delta' && data.delta?.type === 'thinking_delta') {
          return {
            thinking: data.delta.thinking || '',
            done: false,
          };
        }

        // Handle content_block_delta for tool input (partial JSON) — accumulate
        if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
          const index = data.index ?? 0;
          const existing = this.streamingToolCalls.get(index);
          if (existing && data.delta.partial_json) {
            existing.arguments += data.delta.partial_json;
          }
          return null;
        }

        // Handle message_delta (end of message) — emit accumulated tool calls if any
        if (data.type === 'message_delta' && data.message?.stop_reason) {
          const finishReason = this.mapAnthropicFinishReason(data.message.stop_reason);

          if (this.streamingToolCalls.size > 0) {
            const toolCalls: ToolCall[] = [];
            const sorted = [...this.streamingToolCalls.entries()].sort((a, b) => a[0] - b[0]);
            for (const [, tc] of sorted) {
              toolCalls.push({
                id: tc.id,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments,
                },
              });
            }
            this.streamingToolCalls.clear();

            return {
              toolCalls,
              done: true,
              finishReason,
            };
          }

          return {
            done: true,
            finishReason,
          };
        }

        // Skip other event types (message_start, content_block_start, etc.)
        return null;
      } catch (error) {
        this.logger.warn({ error: (error as Error).message }, '[AnthropicProtocol] Failed to parse stream chunk');
        return null;
      }
    }

    return null;
  }

  private mapAnthropicFinishReason(reason?: string): 'stop' | 'length' | 'tool_calls' | 'error' {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return reason ? 'error' : 'stop';
    }
  }
}

/**
 * Singleton instance
 */
let instance: AnthropicProtocolAdapter | null = null;

export function getAnthropicProtocol(): AnthropicProtocolAdapter {
  if (!instance) {
    instance = new AnthropicProtocolAdapter();
  }
  return instance;
}
