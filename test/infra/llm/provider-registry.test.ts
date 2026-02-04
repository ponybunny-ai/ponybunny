import { LLMProviderRegistry } from '../../../src/infra/llm/provider-registry.js';
import type { LLMProviderMetadata, LLMProviderFactory } from '../../../src/infra/llm/provider-registry.js';
import type { ILLMProvider, LLMMessage, LLMResponse } from '../../../src/infra/llm/llm-provider.js';

// Mock provider for testing
class MockTestProvider implements ILLMProvider {
  constructor(private name: string) {}

  async complete(_messages: LLMMessage[]): Promise<LLMResponse> {
    return {
      content: `Mock response from ${this.name}`,
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

describe('LLMProviderRegistry', () => {
  let registry: LLMProviderRegistry;

  const anthropicMetadata: LLMProviderMetadata = {
    id: 'anthropic',
    name: 'Anthropic Claude',
    authType: 'api-key',
    supportedModels: ['claude-opus-4-5-20251101', 'claude-3-5-sonnet-20241022'],
    modelPrefixes: ['claude-'],
    costPer1kTokens: {
      'claude-opus-4-5-20251101': { input: 0.015, output: 0.075 },
      'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
    },
    defaultModel: 'claude-opus-4-5-20251101',
    envVarKey: 'TEST_ANTHROPIC_API_KEY',
  };

  const openaiMetadata: LLMProviderMetadata = {
    id: 'openai',
    name: 'OpenAI',
    authType: 'api-key',
    supportedModels: ['gpt-4o', 'gpt-4o-mini'],
    modelPrefixes: ['gpt-'],
    costPer1kTokens: {
      'gpt-4o': { input: 0.005, output: 0.015 },
      'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    },
    defaultModel: 'gpt-4o',
    envVarKey: 'TEST_OPENAI_API_KEY',
  };

  const anthropicFactory: LLMProviderFactory = () => new MockTestProvider('anthropic');
  const openaiFactory: LLMProviderFactory = () => new MockTestProvider('openai');

  beforeEach(() => {
    registry = new LLMProviderRegistry();
    // Clear test env vars
    delete process.env.TEST_ANTHROPIC_API_KEY;
    delete process.env.TEST_OPENAI_API_KEY;
  });

  afterEach(() => {
    delete process.env.TEST_ANTHROPIC_API_KEY;
    delete process.env.TEST_OPENAI_API_KEY;
  });

  describe('register', () => {
    it('should register a provider with metadata and factory', () => {
      registry.register(anthropicMetadata, anthropicFactory);

      const metadata = registry.getMetadata('anthropic');
      expect(metadata).toBeDefined();
      expect(metadata?.id).toBe('anthropic');
      expect(metadata?.defaultModel).toBe('claude-opus-4-5-20251101');
    });

    it('should register multiple providers', () => {
      registry.register(anthropicMetadata, anthropicFactory);
      registry.register(openaiMetadata, openaiFactory);

      const allMetadata = registry.getAllMetadata();
      expect(allMetadata).toHaveLength(2);
      expect(allMetadata.map(m => m.id)).toContain('anthropic');
      expect(allMetadata.map(m => m.id)).toContain('openai');
    });
  });

  describe('getProvider', () => {
    it('should return undefined if no API key is set', () => {
      registry.register(anthropicMetadata, anthropicFactory);

      const provider = registry.getProvider('anthropic');
      expect(provider).toBeUndefined();
    });

    it('should return provider instance when API key is set', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';
      registry.register(anthropicMetadata, anthropicFactory);

      const provider = registry.getProvider('anthropic');
      expect(provider).toBeDefined();
      expect(provider?.getName()).toBe('anthropic');
    });

    it('should return undefined for unknown provider', () => {
      const provider = registry.getProvider('unknown');
      expect(provider).toBeUndefined();
    });

    it('should cache provider instances', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';
      registry.register(anthropicMetadata, anthropicFactory);

      const provider1 = registry.getProvider('anthropic');
      const provider2 = registry.getProvider('anthropic');
      expect(provider1).toBe(provider2);
    });
  });

  describe('getProviderForModel', () => {
    beforeEach(() => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';
      process.env.TEST_OPENAI_API_KEY = 'test-key';
      registry.register(anthropicMetadata, anthropicFactory);
      registry.register(openaiMetadata, openaiFactory);
    });

    it('should return correct provider for exact model match', () => {
      const provider = registry.getProviderForModel('claude-opus-4-5-20251101');
      expect(provider).toBeDefined();
      expect(provider?.getName()).toBe('anthropic');
    });

    it('should return correct provider for prefix match', () => {
      const provider = registry.getProviderForModel('claude-3-haiku-20240307');
      expect(provider).toBeDefined();
      expect(provider?.getName()).toBe('anthropic');
    });

    it('should return correct provider for OpenAI models', () => {
      const provider = registry.getProviderForModel('gpt-4o');
      expect(provider).toBeDefined();
      expect(provider?.getName()).toBe('openai');
    });

    it('should return undefined for unknown model', () => {
      const provider = registry.getProviderForModel('unknown-model');
      expect(provider).toBeUndefined();
    });
  });

  describe('getProviderIdForModel', () => {
    beforeEach(() => {
      registry.register(anthropicMetadata, anthropicFactory);
      registry.register(openaiMetadata, openaiFactory);
    });

    it('should return provider ID for exact model match', () => {
      const id = registry.getProviderIdForModel('claude-opus-4-5-20251101');
      expect(id).toBe('anthropic');
    });

    it('should return provider ID for prefix match', () => {
      const id = registry.getProviderIdForModel('gpt-4-turbo');
      expect(id).toBe('openai');
    });

    it('should return undefined for unknown model', () => {
      const id = registry.getProviderIdForModel('unknown-model');
      expect(id).toBeUndefined();
    });
  });

  describe('getAllProviders', () => {
    it('should return only providers with valid API keys', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';
      registry.register(anthropicMetadata, anthropicFactory);
      registry.register(openaiMetadata, openaiFactory);

      const providers = registry.getAllProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0].getName()).toBe('anthropic');
    });

    it('should return all providers when all have API keys', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';
      process.env.TEST_OPENAI_API_KEY = 'test-key';
      registry.register(anthropicMetadata, anthropicFactory);
      registry.register(openaiMetadata, openaiFactory);

      const providers = registry.getAllProviders();
      expect(providers).toHaveLength(2);
    });
  });

  describe('hasApiKey', () => {
    beforeEach(() => {
      registry.register(anthropicMetadata, anthropicFactory);
    });

    it('should return false when API key is not set', () => {
      expect(registry.hasApiKey('anthropic')).toBe(false);
    });

    it('should return true when API key is set', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';
      expect(registry.hasApiKey('anthropic')).toBe(true);
    });

    it('should return false for unknown provider', () => {
      expect(registry.hasApiKey('unknown')).toBe(false);
    });
  });

  describe('getAvailableProviderIds', () => {
    beforeEach(() => {
      registry.register(anthropicMetadata, anthropicFactory);
      registry.register(openaiMetadata, openaiFactory);
    });

    it('should return empty array when no API keys are set', () => {
      const ids = registry.getAvailableProviderIds();
      expect(ids).toHaveLength(0);
    });

    it('should return only providers with API keys', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';

      const ids = registry.getAvailableProviderIds();
      expect(ids).toEqual(['anthropic']);
    });

    it('should return all providers when all have API keys', () => {
      process.env.TEST_ANTHROPIC_API_KEY = 'test-key';
      process.env.TEST_OPENAI_API_KEY = 'test-key';

      const ids = registry.getAvailableProviderIds();
      expect(ids).toContain('anthropic');
      expect(ids).toContain('openai');
    });
  });
});
