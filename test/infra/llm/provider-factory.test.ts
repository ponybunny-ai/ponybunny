import {
  PROVIDER_METADATA,
  createProviderRegistry,
  estimateModelCost,
  isModelSupported,
  getAllSupportedModels,
} from '../../../src/infra/llm/provider-factory.js';

describe('Provider Factory', () => {
  describe('PROVIDER_METADATA', () => {
    it('should have anthropic provider metadata', () => {
      expect(PROVIDER_METADATA.anthropic).toBeDefined();
      expect(PROVIDER_METADATA.anthropic.id).toBe('anthropic');
      expect(PROVIDER_METADATA.anthropic.defaultModel).toBe('claude-opus-4-5');
      expect(PROVIDER_METADATA.anthropic.modelPrefixes).toContain('claude-');
    });

    it('should have openai provider metadata', () => {
      expect(PROVIDER_METADATA.openai).toBeDefined();
      expect(PROVIDER_METADATA.openai.id).toBe('openai');
      expect(PROVIDER_METADATA.openai.defaultModel).toBe('gpt-5.2');
      expect(PROVIDER_METADATA.openai.modelPrefixes).toContain('gpt-');
    });

    it('should have gemini provider metadata', () => {
      expect(PROVIDER_METADATA.gemini).toBeDefined();
      expect(PROVIDER_METADATA.gemini.id).toBe('gemini');
      expect(PROVIDER_METADATA.gemini.defaultModel).toBe('gemini-2.0-flash');
      expect(PROVIDER_METADATA.gemini.modelPrefixes).toContain('gemini-');
    });

    it('should include Claude Opus 4.5 in anthropic supported models', () => {
      expect(PROVIDER_METADATA.anthropic.supportedModels).toContain('claude-opus-4-5-20251101');
    });

    it('should have cost data for Claude Opus 4.5', () => {
      const costs = PROVIDER_METADATA.anthropic.costPer1kTokens['claude-opus-4-5-20251101'];
      expect(costs).toBeDefined();
      expect(costs.input).toBe(0.015);
      expect(costs.output).toBe(0.075);
    });
  });

  describe('createProviderRegistry', () => {
    it('should create a registry with all providers registered', () => {
      const registry = createProviderRegistry();

      expect(registry.getMetadata('anthropic')).toBeDefined();
      expect(registry.getMetadata('openai')).toBeDefined();
      expect(registry.getMetadata('gemini')).toBeDefined();
    });

    it('should return correct provider ID for Claude models', () => {
      const registry = createProviderRegistry();

      expect(registry.getProviderIdForModel('claude-opus-4-5-20251101')).toBe('anthropic');
      expect(registry.getProviderIdForModel('claude-3-5-sonnet-20241022')).toBe('anthropic');
      expect(registry.getProviderIdForModel('claude-3-haiku-20240307')).toBe('anthropic');
    });

    it('should return correct provider ID for OpenAI models', () => {
      const registry = createProviderRegistry();

      expect(registry.getProviderIdForModel('gpt-5.2')).toBe('openai');
      expect(registry.getProviderIdForModel('gpt-4-turbo')).toBe('openai');
      expect(registry.getProviderIdForModel('o1')).toBe('openai');
    });

    it('should return correct provider ID for Gemini models', () => {
      const registry = createProviderRegistry();

      expect(registry.getProviderIdForModel('gemini-2.5-pro')).toBe('gemini');
      expect(registry.getProviderIdForModel('gemini-2.0-flash')).toBe('gemini');
    });
  });

  describe('estimateModelCost', () => {
    it('should calculate cost for Claude Opus 4.5', () => {
      const cost = estimateModelCost('claude-opus-4-5-20251101', 1000, 1000);
      // $0.015/1k input + $0.075/1k output = $0.09
      expect(cost).toBeCloseTo(0.09, 4);
    });

    it('should calculate cost for GPT-5.2', () => {
      const cost = estimateModelCost('gpt-5.2', 1000, 1000);
      // $0.01/1k input + $0.03/1k output = $0.04
      expect(cost).toBeCloseTo(0.04, 4);
    });

    it('should calculate cost for Gemini 2.0 Flash', () => {
      const cost = estimateModelCost('gemini-2.0-flash', 1000, 1000);
      // $0.0001/1k input + $0.0004/1k output = $0.0005
      expect(cost).toBeCloseTo(0.0005, 6);
    });

    it('should return fallback cost for unknown model', () => {
      const cost = estimateModelCost('unknown-model', 1000, 1000);
      // Default: $0.01/1k for both
      expect(cost).toBeCloseTo(0.02, 4);
    });
  });

  describe('isModelSupported', () => {
    it('should return true for supported models', () => {
      expect(isModelSupported('claude-opus-4-5-20251101')).toBe(true);
      expect(isModelSupported('gpt-5.2')).toBe(true);
      expect(isModelSupported('gemini-2.0-flash')).toBe(true);
    });

    it('should return true for models matching prefix', () => {
      expect(isModelSupported('claude-3-haiku-20240307')).toBe(true);
      expect(isModelSupported('gpt-4-turbo-preview')).toBe(true);
      expect(isModelSupported('gemini-1.5-pro')).toBe(true);
    });

    it('should return false for unsupported models', () => {
      expect(isModelSupported('unknown-model')).toBe(false);
      expect(isModelSupported('llama-2-70b')).toBe(false);
    });
  });

  describe('getAllSupportedModels', () => {
    it('should return all supported models from all providers', () => {
      const models = getAllSupportedModels();

      expect(models).toContain('claude-opus-4-5-20251101');
      expect(models).toContain('gpt-5.2');
      expect(models).toContain('gemini-2.0-flash');
    });

    it('should include multiple models per provider', () => {
      const models = getAllSupportedModels();

      // Anthropic models
      expect(models).toContain('claude-3-5-sonnet-20241022');
      expect(models).toContain('claude-3-haiku-20240307');

      // OpenAI models
      expect(models).toContain('o1-mini');
      expect(models).toContain('o1');

      // Gemini models
      expect(models).toContain('gemini-2.5-pro');
      expect(models).toContain('gemini-2.5-flash');
    });
  });
});
