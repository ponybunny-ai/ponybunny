import type { LLMMessage, LLMResponse, ToolCall, ToolDefinition, StreamChunk } from '../llm-provider.js';
import type {
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
} from './protocol-adapter.js';
import { BaseProtocolAdapter } from './protocol-adapter.js';

/**
 * OpenAI Chat Completions API protocol adapter
 * Supports both OpenAI Direct and Azure OpenAI endpoints
 */
export class OpenAIProtocolAdapter extends BaseProtocolAdapter {
  readonly protocolId = 'openai' as const;

  // Streaming tool_calls accumulator state
  private streamingToolCalls = new Map<number, { id: string; type: string; name: string; arguments: string }>();

  /**
   * Reset streaming state (call before each new stream)
   */
  resetStreamState(): void {
    this.streamingToolCalls.clear();
  }

  formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown {
    // Convert messages to OpenAI format
    const openaiMessages = messages.map(m => {
      // Handle tool result messages
      if (m.role === 'tool' && m.tool_call_id) {
        return {
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content: m.content || '',
        };
      }

      // Handle assistant messages with tool calls
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: m.content,
          tool_calls: m.tool_calls.map(tc => ({
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }

      // Regular messages
      return {
        role: m.role,
        content: m.content,
      };
    });

    const requestBody: any = {
      model: config.model,
      messages: openaiMessages,
      max_tokens: config.maxTokens || 4000,
      temperature: config.temperature ?? 0.7,
    };

    // Add tools if provided
    if (config.tools && config.tools.length > 0) {
      requestBody.tools = config.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    // Add tool_choice if specified
    if (config.tool_choice) {
      if (config.tool_choice === 'auto' || config.tool_choice === 'none') {
        requestBody.tool_choice = config.tool_choice;
      } else {
        requestBody.tool_choice = config.tool_choice;
      }
    }

    // Add streaming if enabled
    if (config.stream) {
      requestBody.stream = true;
    }

    // Note: OpenAI o1 models automatically enable reasoning, no explicit flag needed

    return requestBody;
  }

  parseResponse(response: RawApiResponse, model: string): LLMResponse {
    const data = response.data as {
      choices?: Array<{
        message?: {
          content?: string | null;
          reasoning_content?: string;
          tool_calls?: Array<{
            id: string;
            type: string;
            function: {
              name: string;
              arguments: string;
            };
          }>;
        };
        finish_reason?: string;
      }>;
      usage?: { total_tokens: number };
      model?: string;
    };

    const message = data.choices?.[0]?.message;
    const content = message?.content || null;
    const thinking = message?.reasoning_content;
    const toolCalls = message?.tool_calls;
    const tokensUsed = data.usage?.total_tokens || 0;
    const finishReason = this.mapOpenAIFinishReason(data.choices?.[0]?.finish_reason);

    return {
      content,
      tokensUsed,
      model: data.model || model,
      finishReason,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })) : undefined,
      thinking,
    };
  }

  buildHeaders(credentials: EndpointCredentials): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (credentials.apiKey) {
      headers['Authorization'] = `Bearer ${credentials.apiKey}`;
    }

    return headers;
  }

  /**
   * Build URL for Azure OpenAI (different URL pattern)
   */
  buildUrl(baseUrl: string, model: string, _credentials: EndpointCredentials): string {
    // Azure OpenAI uses deployment-based URLs
    if (baseUrl.includes('openai.azure.com')) {
      // Azure format: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview
      return `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-02-15-preview`;
    }
    // Standard OpenAI
    return `${baseUrl}/chat/completions`;
  }

  /**
   * Build headers for Azure OpenAI (uses api-key header instead of Bearer)
   */
  buildAzureHeaders(credentials: EndpointCredentials): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'api-key': credentials.apiKey || '',
    };
  }

  isRecoverableError(status: number, _response?: unknown): boolean {
    return status !== 429;
  }

  supportsStreaming(): boolean {
    return true;
  }

  parseStreamChunk(line: string, _chunkIndex: number): StreamChunk | null {
    // Skip empty lines and comments
    if (!line.trim() || line.startsWith(':')) {
      return null;
    }

    // Parse SSE format: "data: {...}"
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
          choices?: Array<{
            delta?: {
              content?: string;
              reasoning_content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                type?: string;
                function?: {
                  name?: string;
                  arguments?: string;
                };
              }>;
            };
            finish_reason?: string | null;
          }>;
          usage?: { total_tokens: number };
        };

        const choice = data.choices?.[0];
        if (!choice) {
          return null;
        }

        const delta = choice.delta;

        // Handle content delta
        if (delta?.content) {
          return {
            content: delta.content,
            done: false,
          };
        }

        // Handle reasoning_content delta (o1 models)
        if (delta?.reasoning_content) {
          return {
            thinking: delta.reasoning_content,
            done: false,
          };
        }

        // Handle tool_calls delta - accumulate across chunks
        if (delta?.tool_calls && delta.tool_calls.length > 0) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!this.streamingToolCalls.has(index)) {
              // First chunk for this tool call — initialize
              this.streamingToolCalls.set(index, {
                id: tc.id || '',
                type: tc.type || 'function',
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              });
            } else {
              // Subsequent chunk — accumulate arguments
              const existing = this.streamingToolCalls.get(index)!;
              if (tc.id) existing.id = tc.id;
              if (tc.function?.name) existing.name = tc.function.name;
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            }
          }
          // Don't emit yet — wait for finish_reason
          return null;
        }

        // Handle finish reason — emit accumulated tool calls if any
        if (choice.finish_reason) {
          const finishReason = this.mapOpenAIFinishReason(choice.finish_reason);

          // If we accumulated tool calls during streaming, emit them now
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

        // Skip chunks without content or finish reason
        return null;
      } catch (error) {
        console.warn('[OpenAIProtocol] Failed to parse stream chunk:', error);
        return null;
      }
    }

    return null;
  }

  private mapOpenAIFinishReason(reason?: string): 'stop' | 'length' | 'tool_calls' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      default:
        return reason ? 'error' : 'stop';
    }
  }
}

/**
 * Singleton instance
 */
let instance: OpenAIProtocolAdapter | null = null;

export function getOpenAIProtocol(): OpenAIProtocolAdapter {
  if (!instance) {
    instance = new OpenAIProtocolAdapter();
  }
  return instance;
}
