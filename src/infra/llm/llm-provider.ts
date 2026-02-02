export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  model: string;
  finishReason: 'stop' | 'length' | 'error';
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
}

export interface ILLMProvider {
  complete(messages: LLMMessage[], options?: Partial<LLMProviderConfig>): Promise<LLMResponse>;
  getName(): string;
  isAvailable(): Promise<boolean>;
  estimateCost(tokens: number): number;
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public recoverable: boolean = true
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

export class LLMRouter implements ILLMProvider {
  private providers: ILLMProvider[];
  private currentProviderIndex = 0;
  private failedProviders = new Set<string>();

  constructor(providers: ILLMProvider[]) {
    if (providers.length === 0) {
      throw new Error('LLMRouter requires at least one provider');
    }
    this.providers = providers;
  }

  getName(): string {
    return `router(${this.providers.map(p => p.getName()).join(', ')})`;
  }

  async isAvailable(): Promise<boolean> {
    for (const provider of this.providers) {
      if (!this.failedProviders.has(provider.getName())) {
        const available = await provider.isAvailable();
        if (available) return true;
      }
    }
    return false;
  }

  estimateCost(tokens: number): number {
    return this.getCurrentProvider().estimateCost(tokens);
  }

  async complete(messages: LLMMessage[], options?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.providers.length; attempt++) {
      const provider = this.getCurrentProvider();
      
      if (this.failedProviders.has(provider.getName())) {
        this.rotateProvider();
        continue;
      }

      try {
        const isAvailable = await provider.isAvailable();
        
        if (!isAvailable) {
          console.warn(`[LLMRouter] Provider ${provider.getName()} is unavailable`);
          this.markProviderFailed(provider.getName());
          this.rotateProvider();
          continue;
        }

        const response = await provider.complete(messages, options);
        this.currentProviderIndex = this.providers.indexOf(provider);
        return response;
      } catch (error) {
        lastError = error as Error;
        
        if (error instanceof LLMProviderError && !error.recoverable) {
          throw error;
        }

        console.warn(
          `[LLMRouter] Provider ${provider.getName()} failed: ${(error as Error).message}`
        );
        
        this.markProviderFailed(provider.getName());
        this.rotateProvider();
      }
    }

    throw new Error(
      `All LLM providers failed. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  private getCurrentProvider(): ILLMProvider {
    return this.providers[this.currentProviderIndex];
  }

  private rotateProvider(): void {
    this.currentProviderIndex = (this.currentProviderIndex + 1) % this.providers.length;
  }

  private markProviderFailed(providerName: string): void {
    this.failedProviders.add(providerName);

    setTimeout(() => {
      this.failedProviders.delete(providerName);
      console.log(`[LLMRouter] Re-enabled provider ${providerName}`);
    }, 60000);
  }

  getAvailableProviders(): string[] {
    return this.providers
      .map(p => p.getName())
      .filter(name => !this.failedProviders.has(name));
  }

  resetFailures(): void {
    this.failedProviders.clear();
  }
}

export class MockLLMProvider implements ILLMProvider {
  constructor(private name: string = 'mock') {}

  async complete(messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: `Mock response to: ${messages[messages.length - 1].content}`,
      tokensUsed: 100,
      model: this.name,
      finishReason: 'stop',
    };
  }

  getName(): string {
    return this.name;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  estimateCost(tokens: number): number {
    return tokens * 0.00001;
  }
}
