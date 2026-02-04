import type { LLMMessage, LLMResponse } from '../llm-provider.js';
import type {
  EndpointCredentials,
  ProtocolRequestConfig,
  RawApiResponse,
} from './protocol-adapter.js';
import { BaseProtocolAdapter } from './protocol-adapter.js';

/**
 * Google Gemini API protocol adapter
 * Supports both Google AI Studio and Vertex AI endpoints
 */
export class GeminiProtocolAdapter extends BaseProtocolAdapter {
  readonly protocolId = 'gemini' as const;

  formatRequest(messages: LLMMessage[], config: ProtocolRequestConfig): unknown {
    // Extract system message and conversation messages
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Convert to Gemini format
    const contents = conversationMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const systemInstruction = systemMessage
      ? { parts: [{ text: systemMessage.content }] }
      : undefined;

    return {
      contents,
      systemInstruction,
      generationConfig: {
        maxOutputTokens: config.maxTokens || 4000,
        temperature: config.temperature ?? 0.7,
      },
    };
  }

  parseResponse(response: RawApiResponse, model: string): LLMResponse {
    const data = response.data as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
      promptFeedback?: { blockReason?: string };
    };

    // Extract text from response
    const textParts: string[] = [];
    const candidates = data.candidates;

    if (Array.isArray(candidates) && candidates.length > 0) {
      const firstCandidate = candidates[0];
      const parts = firstCandidate?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part?.text) {
            textParts.push(part.text);
          }
        }
      }
    }

    const content = textParts.join('');

    // Extract token usage
    const usageMetadata = data.usageMetadata;
    const tokensUsed = (usageMetadata?.promptTokenCount || 0) +
                       (usageMetadata?.candidatesTokenCount || 0);

    // Map finish reason
    const finishReason = this.mapGeminiFinishReason(candidates?.[0]?.finishReason);

    return {
      content,
      tokensUsed,
      model,
      finishReason,
    };
  }

  buildHeaders(_credentials: EndpointCredentials): Record<string, string> {
    // Gemini uses API key in URL query param, not headers
    return {
      'Content-Type': 'application/json',
    };
  }

  buildUrl(baseUrl: string, model: string, credentials: EndpointCredentials): string {
    // Google AI Studio format
    if (baseUrl.includes('generativelanguage.googleapis.com')) {
      return `${baseUrl}/models/${model}:generateContent?key=${credentials.apiKey}`;
    }
    // Vertex AI format
    if (baseUrl.includes('aiplatform.googleapis.com')) {
      const region = credentials.region || 'us-central1';
      const projectId = credentials.projectId;
      return `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
    }
    return baseUrl;
  }

  isRecoverableError(status: number, response?: unknown): boolean {
    // Check for blocked content
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      if (resp.promptFeedback && typeof resp.promptFeedback === 'object') {
        const feedback = resp.promptFeedback as Record<string, unknown>;
        if (feedback.blockReason) {
          return false; // Content blocked, not recoverable
        }
      }
    }
    return status !== 429;
  }

  extractErrorMessage(response: unknown): string {
    if (typeof response === 'object' && response !== null) {
      const resp = response as Record<string, unknown>;
      // Check for block reason
      if (resp.promptFeedback && typeof resp.promptFeedback === 'object') {
        const feedback = resp.promptFeedback as Record<string, unknown>;
        if (feedback.blockReason) {
          return `Content blocked: ${feedback.blockReason}`;
        }
      }
    }
    return super.extractErrorMessage(response);
  }

  private mapGeminiFinishReason(reason?: string): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
        return 'error';
      default:
        return reason ? 'error' : 'stop';
    }
  }
}

/**
 * Singleton instance
 */
let instance: GeminiProtocolAdapter | null = null;

export function getGeminiProtocol(): GeminiProtocolAdapter {
  if (!instance) {
    instance = new GeminiProtocolAdapter();
  }
  return instance;
}
