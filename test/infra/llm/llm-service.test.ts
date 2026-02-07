import {
  LLMService,
  DEFAULT_TIER_MODELS,
  resetLLMService,
} from '../../../src/infra/llm/llm-service.js';
import { resetProviderRegistry } from '../../../src/infra/llm/provider-factory.js';
import { resetModelRouter } from '../../../src/infra/llm/routing/model-router.js';

// Mock the credentials loader to prevent loading from ~/.ponybunny/credentials.json
jest.mock('../../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));

describe('LLMService', () => {
  beforeEach(() => {
    // Reset singletons before each test
    resetLLMService();
    resetProviderRegistry();
    resetModelRouter();
    // Clear env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.PONY_MODEL_SIMPLE;
    delete process.env.PONY_MODEL_MEDIUM;
    delete process.env.PONY_MODEL_COMPLEX;
    delete process.env.PONY_MODEL_SIMPLE_FALLBACK;
    delete process.env.PONY_MODEL_MEDIUM_FALLBACK;
    delete process.env.PONY_MODEL_COMPLEX_FALLBACK;
  });

  afterEach(() => {
    resetLLMService();
    resetProviderRegistry();
    resetModelRouter();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.PONY_MODEL_SIMPLE;
    delete process.env.PONY_MODEL_MEDIUM;
    delete process.env.PONY_MODEL_COMPLEX;
    delete process.env.PONY_MODEL_SIMPLE_FALLBACK;
    delete process.env.PONY_MODEL_MEDIUM_FALLBACK;
    delete process.env.PONY_MODEL_COMPLEX_FALLBACK;
  });

  describe('DEFAULT_TIER_MODELS', () => {
    it('should have Claude-first strategy for simple tier', () => {
      expect(DEFAULT_TIER_MODELS.simple.primary).toBe('claude-haiku-4-5');
      expect(DEFAULT_TIER_MODELS.simple.fallback).toBe('gpt-5.2');
    });

    it('should have Claude-first strategy for medium tier', () => {
      expect(DEFAULT_TIER_MODELS.medium.primary).toBe('claude-sonnet-4-5');
      expect(DEFAULT_TIER_MODELS.medium.fallback).toBe('gpt-5.2');
    });

    it('should have Claude Opus 4.5 as primary for complex tier', () => {
      expect(DEFAULT_TIER_MODELS.complex.primary).toBe('claude-opus-4-5');
      expect(DEFAULT_TIER_MODELS.complex.fallback).toBe('gpt-5.2');
    });
  });

  describe('constructor', () => {
    it('should create service with default tier models', () => {
      const service = new LLMService();
      const tierModels = service.getTierModels();

      expect(tierModels.simple.primary).toBe('claude-haiku-4-5');
      expect(tierModels.medium.primary).toBe('claude-sonnet-4-5');
      expect(tierModels.complex.primary).toBe('claude-opus-4-5');
    });

    it('should allow custom tier model configuration', () => {
      const service = new LLMService({
        tierModels: {
          complex: {
            primary: 'gpt-4o',
            fallback: 'claude-3-5-sonnet-20241022',
          },
        },
      });

      const tierModels = service.getTierModels();
      expect(tierModels.complex.primary).toBe('gpt-4o');
      expect(tierModels.complex.fallback).toBe('claude-3-5-sonnet-20241022');
    });

    it('should respect environment variable overrides', () => {
      process.env.PONY_MODEL_COMPLEX = 'gpt-4-turbo';
      process.env.PONY_MODEL_COMPLEX_FALLBACK = 'claude-3-opus-20240229';

      const service = new LLMService();
      const tierModels = service.getTierModels();

      expect(tierModels.complex.primary).toBe('gpt-4-turbo');
      expect(tierModels.complex.fallback).toBe('claude-3-opus-20240229');
    });
  });

  describe('getAvailableProviders', () => {
    it('should return empty array when no API keys are set', () => {
      const service = new LLMService();
      const providers = service.getAvailableProviders();
      expect(providers).toHaveLength(0);
    });

    it('should return anthropic when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const service = new LLMService();
      const providers = service.getAvailableProviders();
      expect(providers).toContain('anthropic');
    });

    it('should return openai when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const service = new LLMService();
      const providers = service.getAvailableProviders();
      expect(providers).toContain('openai');
    });

    it('should return gemini when GEMINI_API_KEY is set', () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const service = new LLMService();
      const providers = service.getAvailableProviders();
      expect(providers).toContain('gemini');
    });

    it('should return all providers when all API keys are set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.OPENAI_API_KEY = 'test-key';
      process.env.GEMINI_API_KEY = 'test-key';

      const service = new LLMService();
      const providers = service.getAvailableProviders();

      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');
      expect(providers).toContain('gemini');
    });
  });

  describe('getName', () => {
    it('should return llm-service', () => {
      const service = new LLMService();
      expect(service.getName()).toBe('llm-service');
    });
  });

  describe('isAvailable', () => {
    it('should return false when no providers are available', async () => {
      const service = new LLMService();
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });

    it('should return true when at least one provider is available', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const service = new LLMService();
      const available = await service.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getModelForTier', () => {
    it('should return primary model when provider is available', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const service = new LLMService();

      expect(service.getModelForTier('simple')).toBe('claude-haiku-4-5');
      expect(service.getModelForTier('medium')).toBe('claude-sonnet-4-5');
      expect(service.getModelForTier('complex')).toBe('claude-opus-4-5');
    });

    it('should return fallback model when primary provider is not available', () => {
      process.env.OPENAI_API_KEY = 'test-key';
      const service = new LLMService();

      // Primary is Claude but no ANTHROPIC_API_KEY, so should fall back to OpenAI
      expect(service.getModelForTier('simple')).toBe('gpt-5.2');
      expect(service.getModelForTier('medium')).toBe('gpt-5.2');
      expect(service.getModelForTier('complex')).toBe('gpt-5.2');
    });
  });

  describe('estimateCostForModel', () => {
    it('should estimate cost for Claude Opus 4.5', () => {
      const service = new LLMService();
      const cost = service.estimateCostForModel(1000, 1000, 'claude-opus-4-5-20251101');
      // $0.015/1k input + $0.075/1k output = $0.09
      expect(cost).toBeCloseTo(0.09, 4);
    });

    it('should estimate cost for GPT-4o', () => {
      const service = new LLMService();
      const cost = service.estimateCostForModel(1000, 1000, 'gpt-4o');
      // $0.005/1k input + $0.015/1k output = $0.02
      expect(cost).toBeCloseTo(0.02, 4);
    });
  });

  describe('createRouter', () => {
    it('should throw error when no providers are available', () => {
      const service = new LLMService();
      expect(() => service.createRouter()).toThrow('No LLM providers available');
    });

    it('should create router when providers are available', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const service = new LLMService();
      const router = service.createRouter();
      expect(router).toBeDefined();
      expect(router.getName()).toContain('router');
    });
  });
});
