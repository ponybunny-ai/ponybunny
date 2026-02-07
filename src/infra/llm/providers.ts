import type { ILLMProvider, LLMMessage, LLMResponse, LLMProviderConfig } from './llm-provider.js';
import { LLMProviderError } from './llm-provider.js';

export class OpenAIProvider implements ILLMProvider {
  private baseUrl = 'https://api.openai.com/v1';
  
  constructor(private config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }

  async complete(messages: LLMMessage[], options?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };
    
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${mergedConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: mergedConfig.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          max_tokens: mergedConfig.maxTokens || 4000,
          temperature: mergedConfig.temperature ?? 0.7,
        }),
        signal: AbortSignal.timeout(mergedConfig.timeout || 60000),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } })) as any;
        throw new LLMProviderError(
          `OpenAI API error: ${error.error?.message || response.statusText}`,
          'openai',
          response.status !== 429
        );
      }

      const data = await response.json() as any;
      
      return {
        content: data.choices[0].message.content,
        tokensUsed: data.usage.total_tokens,
        model: data.model,
        finishReason: data.choices[0].finish_reason === 'stop' ? 'stop' : 
                      data.choices[0].finish_reason === 'length' ? 'length' : 'error',
      };
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }
      
      throw new LLMProviderError(
        `OpenAI request failed: ${(error as Error).message}`,
        'openai',
        true
      );
    }
  }

  getName(): string {
    return `openai-${this.config.model}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });
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
    const costs: Record<string, number> = {
      'gpt-4': 0.03,
      'gpt-4-turbo': 0.01,
      'gpt-3.5-turbo': 0.0015,
      'gpt-5.2': 0.01,
    };
    return costs[model] || 0.01;
  }
}

export class AnthropicProvider implements ILLMProvider {
  private baseUrl = 'https://api.anthropic.com/v1';
  
  constructor(private config: LLMProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }
  }

  async complete(messages: LLMMessage[], options?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };
    
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': mergedConfig.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: mergedConfig.model,
          messages: conversationMessages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
          system: systemMessage?.content,
          max_tokens: mergedConfig.maxTokens || 4000,
          temperature: mergedConfig.temperature ?? 0.7,
        }),
        signal: AbortSignal.timeout(mergedConfig.timeout || 60000),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: response.statusText } })) as any;
        throw new LLMProviderError(
          `Anthropic API error: ${error.error?.message || response.statusText}`,
          'anthropic',
          response.status !== 429
        );
      }

      const data = await response.json() as any;
      
      return {
        content: data.content[0].text,
        tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
        model: data.model,
        finishReason: data.stop_reason === 'end_turn' ? 'stop' :
                      data.stop_reason === 'max_tokens' ? 'length' : 'error',
      };
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }
      
      throw new LLMProviderError(
        `Anthropic request failed: ${(error as Error).message}`,
        'anthropic',
        true
      );
    }
  }

  getName(): string {
    return `anthropic-${this.config.model}`;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok || response.status === 400;
    } catch {
      return false;
    }
  }

  estimateCost(tokens: number): number {
    const costPer1kTokens = this.getCostPer1kTokens(this.config.model);
    return (tokens / 1000) * costPer1kTokens;
  }

  private getCostPer1kTokens(model: string): number {
    const costs: Record<string, number> = {
      'claude-opus-4-5-20251101': 0.015,
      'claude-sonnet-4-20250514': 0.003,
      'claude-3-5-sonnet-20241022': 0.003,
      'claude-3-opus-20240229': 0.015,
      'claude-3-sonnet-20240229': 0.003,
      'claude-3-haiku-20240307': 0.00025,
    };
    return costs[model] || 0.003;
  }
}
