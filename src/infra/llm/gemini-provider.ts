import type { ILLMProvider, LLMMessage, LLMResponse, LLMProviderConfig } from './llm-provider.js';
import { LLMProviderError } from './llm-provider.js';

/**
 * Google AI Studio (Gemini) Provider
 * Uses the generativelanguage.googleapis.com API (not Cloud Vertex AI)
 */
export class GeminiProvider implements ILLMProvider {
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(private config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Gemini API key is required');
    }
  }

  async complete(messages: LLMMessage[], options?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };
    const model = mergedConfig.model || 'gemini-2.0-flash';

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

    try {
      const response = await fetch(
        `${this.baseUrl}/models/${model}:generateContent?key=${mergedConfig.apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents,
            systemInstruction,
            generationConfig: {
              maxOutputTokens: mergedConfig.maxTokens || 4000,
              temperature: mergedConfig.temperature ?? 0.7,
            },
          }),
          signal: AbortSignal.timeout(mergedConfig.timeout || 60000),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } })) as any;
        throw new LLMProviderError(
          `Gemini API error: ${error.error?.message || response.statusText}`,
          'gemini',
          response.status !== 429
        );
      }

      const data = await response.json() as any;

      // Extract text from response
      const textParts: string[] = [];
      const candidates = data?.candidates;

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

      if (!content) {
        // Check for blocked content
        const blockReason = data?.promptFeedback?.blockReason;
        if (blockReason) {
          throw new LLMProviderError(
            `Gemini blocked request: ${blockReason}`,
            'gemini',
            false
          );
        }
      }

      // Extract token usage
      const usageMetadata = data?.usageMetadata;
      const tokensUsed = (usageMetadata?.promptTokenCount || 0) +
                         (usageMetadata?.candidatesTokenCount || 0);

      // Map finish reason
      const finishReason = this.mapFinishReason(candidates?.[0]?.finishReason);

      return {
        content: content || '',
        tokensUsed,
        model,
        finishReason,
      };
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }

      throw new LLMProviderError(
        `Gemini request failed: ${(error as Error).message}`,
        'gemini',
        true
      );
    }
  }

  getName(): string {
    return `gemini-${this.config.model}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Use a lightweight models list endpoint to check availability
      const response = await fetch(
        `${this.baseUrl}/models?key=${this.config.apiKey}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  estimateCost(tokens: number): number {
    const costPer1kTokens = this.getCostPer1kTokens(this.config.model);
    return (tokens / 1000) * costPer1kTokens;
  }

  private getCostPer1kTokens(model: string): number {
    // Gemini pricing (approximate, as of 2024)
    const costs: Record<string, number> = {
      'gemini-2.5-pro': 0.00125,      // $1.25/M input
      'gemini-2.5-flash': 0.000075,   // $0.075/M input
      'gemini-2.0-flash': 0.0001,     // $0.10/M input
      'gemini-1.5-pro': 0.00125,
      'gemini-1.5-flash': 0.000075,
    };
    return costs[model] || 0.0001;
  }

  private mapFinishReason(reason?: string): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'OTHER':
      default:
        return reason ? 'error' : 'stop';
    }
  }
}
