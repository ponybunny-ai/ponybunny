import type { LLMMessage, LLMResponse } from '../llm-provider.js';
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

  formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown {
    return {
      model: config.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: config.maxTokens || 4000,
      temperature: config.temperature ?? 0.7,
    };
  }

  parseResponse(response: RawApiResponse, model: string): LLMResponse {
    const data = response.data as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      usage?: { total_tokens: number };
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content || '';
    const tokensUsed = data.usage?.total_tokens || 0;
    const finishReason = this.mapOpenAIFinishReason(data.choices?.[0]?.finish_reason);

    return {
      content,
      tokensUsed,
      model: data.model || model,
      finishReason,
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

  private mapOpenAIFinishReason(reason?: string): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
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
