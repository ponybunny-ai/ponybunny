export interface ToolCall {
  id: string;              // Unique ID for the tool call
  type: 'function';
  function: {
    name: string;
    arguments: string;     // JSON string
  };
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;  // null when tool_calls present
  tool_calls?: ToolCall[];  // Assistant's tool calls
  tool_call_id?: string;    // For tool result messages
}

export interface LLMResponse {
  content: string | null;
  tokensUsed: number;
  model: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  toolCalls?: ToolCall[];  // LLM's requested tool calls
  thinking?: string;       // Reasoning process (if model supports)
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: any[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
}

export interface StreamChunk {
  content?: string;              // Text content
  thinking?: string;             // Reasoning content
  toolCalls?: ToolCall[];        // Tool calls
  done: boolean;                 // Whether streaming is complete
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
}

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  tools?: ToolDefinition[];      // Available tools
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  thinking?: boolean;            // Enable thinking mode (default based on model config)
  stream?: boolean;              // Enable streaming (default based on model config)
  onChunk?: (chunk: StreamChunk) => void;  // Streaming callback
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
