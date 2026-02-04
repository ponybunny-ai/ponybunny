import type { LLMMessage, LLMResponse } from '../llm-provider.js';
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

    return {
      model: config.model,
      messages: conversationMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      system: systemMessage?.content,
      max_tokens: config.maxTokens || 4000,
      temperature: config.temperature ?? 0.7,
    };
  }

  parseResponse(response: RawApiResponse, model: string): LLMResponse {
    const data = response.data as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
      model?: string;
      stop_reason?: string;
    };

    // Extract text content
    let content = '';
    if (Array.isArray(data.content)) {
      const textBlock = data.content.find(c => c.type === 'text');
      content = textBlock?.text || '';
    }

    // Calculate tokens
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

    return {
      content,
      tokensUsed,
      model: data.model || model,
      finishReason: this.mapAnthropicFinishReason(data.stop_reason),
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

  private mapAnthropicFinishReason(reason?: string): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
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
