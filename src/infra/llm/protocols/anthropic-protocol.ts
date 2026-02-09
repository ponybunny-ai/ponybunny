import type { LLMMessage, LLMResponse, ToolCall, ToolDefinition, StreamChunk } from '../llm-provider.js';
import type {
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
} from './protocol-adapter.js';
import { BaseProtocolAdapter } from './protocol-adapter.js';

/**
 * Anthropic Messages API protocol adapter
 * Supports both Anthropic Direct and AWS Bedrock endpoints
 */
export class AnthropicProtocolAdapter extends BaseProtocolAdapter {
  readonly protocolId = 'anthropic' as const;

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
        const content: any[] = [];

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

    const requestBody: any = {
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
      if (config.tool_choice === 'auto' || config.tool_choice === 'none') {
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
        input?: any;
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
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

    return {
      content: content || null,
      tokensUsed,
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

        // Handle content_block_start for tool_use
        if (data.type === 'content_block_start' && data.content_block?.type === 'tool_use') {
          // Tool use started - we'll accumulate the input in subsequent deltas
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

        // Handle content_block_delta for tool input (partial JSON)
        if (data.type === 'content_block_delta' && data.delta?.type === 'input_json_delta') {
          // Tool input is being streamed - we need to accumulate this
          // For now, we'll skip individual chunks and wait for the complete message
          return null;
        }

        // Handle message_delta (end of message)
        if (data.type === 'message_delta' && data.message?.stop_reason) {
          return {
            done: true,
            finishReason: this.mapAnthropicFinishReason(data.message.stop_reason),
          };
        }

        // Skip other event types (message_start, content_block_start, etc.)
        return null;
      } catch (error) {
        console.warn('[AnthropicProtocol] Failed to parse stream chunk:', error);
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
