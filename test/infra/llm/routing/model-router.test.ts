import {
  ModelRouter,
  getModelRouter,
  resetModelRouter,
} from '../../../../src/infra/llm/routing/model-router.js';
import type { ModelRoutingConfig } from '../../../../src/infra/llm/routing/routing-config.js';
import { getCachedConfig, clearConfigCache } from '../../../../src/infra/llm/provider-manager/config-loader.js';

// Mock the credentials loader to prevent loading from ~/.ponybunny/credentials.json
jest.mock('../../../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));

describe('ModelRouter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearConfigCache();
    resetModelRouter();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearConfigCache();
    resetModelRouter();
  });

  describe('getProtocolForModel', () => {
    it('should return anthropic for claude models', () => {
      const router = new ModelRouter();

      expect(router.getProtocolForModel('anthropic.claude-opus-4-5-20251101')).toBe('anthropic');
      expect(router.getProtocolForModel('anthropic.claude-sonnet-4-5-20250929')).toBe('anthropic');
      expect(router.getProtocolForModel('anthropic.claude-haiku-4-5-20251001')).toBe('anthropic');
    });

    it('should return openai for gpt models', () => {
      const router = new ModelRouter();

      expect(router.getProtocolForModel('gpt-4o')).toBe('openai');
      expect(router.getProtocolForModel('gpt-4-turbo')).toBe('openai');
      expect(router.getProtocolForModel('gpt-3.5-turbo')).toBe('openai');
    });

    it('should return openai for o1 models', () => {
      const router = new ModelRouter();

      expect(router.getProtocolForModel('o1')).toBe('openai');
      expect(router.getProtocolForModel('o1-mini')).toBe('openai');
      expect(router.getProtocolForModel('o1-preview')).toBe('openai');
    });

    it('should return gemini for gemini models', () => {
      const router = new ModelRouter();

      expect(router.getProtocolForModel('gemini-2.0-flash')).toBe('gemini');
      expect(router.getProtocolForModel('gemini-1.5-pro')).toBe('gemini');
    });

    it('should return undefined for unknown models', () => {
      const router = new ModelRouter();

      expect(router.getProtocolForModel('unknown-model')).toBeUndefined();
    });
  });

  describe('getEndpointsForModel', () => {
    it('should return available endpoints for claude models', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const router = new ModelRouter();
      const endpoints = router.getEndpointsForModel('anthropic.claude-opus-4-5-20251101');

      expect(endpoints.length).toBeGreaterThan(0);
      expect(endpoints[0].id).toBe('anthropic');
    });

    it('should prefer scoped provider endpoint for provider-prefixed model ids', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.AWS_ACCESS_KEY_ID = 'test-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

      const router = new ModelRouter();
      const endpoints = router.getEndpointsForModel('anthropic.claude-opus-4-5-20251101');

      expect(endpoints.length).toBe(1);
      expect(endpoints.map(e => e.id)).toContain('anthropic');
      expect(endpoints.map(e => e.id)).not.toContain('aws-bedrock');
    });

    it('should return empty array when no credentials available', () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;

      const router = new ModelRouter();
      const endpoints = router.getEndpointsForModel('anthropic.claude-opus-4-5-20251101');

      expect(endpoints.length).toBe(0);
    });

    it('should skip endpoint marked unavailable by persisted endpoint probe health', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const config = getCachedConfig();
      config.providers.openai.enabled = true;
      config.providers.openai.health = {
        available: false,
        lastCheckedAt: new Date().toISOString(),
        lastError: '502 Bad Gateway',
      };

      const router = new ModelRouter();
      const endpoints = router.getEndpointsForModel('openai.gpt-5.2');

      expect(endpoints.find((endpoint) => endpoint.id === 'openai')).toBeUndefined();
    });

    it('should skip model-endpoint pair marked unavailable by persisted model probe health', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const config = getCachedConfig();
      config.providers.openai.enabled = true;
      config.providers.openai.health = {
        available: true,
        lastCheckedAt: new Date().toISOString(),
      };
      config.models['openai.gpt-5.2'].health = {
        lastCheckedAt: new Date().toISOString(),
        available: false,
        lastError: 'Model unavailable on endpoint',
      };

      const router = new ModelRouter();
      const endpoints = router.getEndpointsForModel('openai.gpt-5.2');

      expect(endpoints.find((endpoint) => endpoint.id === 'openai')).toBeUndefined();
    });

    it('should support provider-prefixed model selector from tiers/workloads', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      const router = new ModelRouter();
      const endpoints = router.getEndpointsForModel('openai.gpt-5.2');

      expect(endpoints.length).toBeGreaterThan(0);
      expect(endpoints.map((endpoint) => endpoint.id)).toContain('openai');
    });

    it('should return empty array for unknown models', () => {
      const router = new ModelRouter();
      const endpoints = router.getEndpointsForModel('unknown-model');

      expect(endpoints.length).toBe(0);
    });

  });

  describe('isEndpointAvailable', () => {
    it('should return true when credentials are set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const router = new ModelRouter();

      expect(router.isEndpointAvailable('anthropic')).toBe(true);
    });

    it('should return false when credentials are missing', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const router = new ModelRouter();

      expect(router.isEndpointAvailable('anthropic')).toBe(false);
    });

    it('should cache availability results', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const router = new ModelRouter();

      // First call
      expect(router.isEndpointAvailable('anthropic')).toBe(true);

      // Remove key
      delete process.env.ANTHROPIC_API_KEY;

      // Should still return cached value
      expect(router.isEndpointAvailable('anthropic')).toBe(true);

      // Clear cache
      router.clearCache();

      // Now should return false
      expect(router.isEndpointAvailable('anthropic')).toBe(false);
    });

    it('should let persisted probe health override cached available status', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const config = getCachedConfig();
      config.providers.openai.enabled = true;
      config.providers.openai.health = {
        available: true,
        lastCheckedAt: new Date().toISOString(),
      };

      const router = new ModelRouter();

      expect(router.isEndpointAvailable('openai')).toBe(true);

      config.providers.openai.health = {
        available: false,
        lastCheckedAt: new Date().toISOString(),
        lastError: '502 Bad Gateway',
      };

      expect(router.isEndpointAvailable('openai')).toBe(false);
    });
  });

  describe('getPreferredEndpoint', () => {
    it('should return first available endpoint', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const router = new ModelRouter();
      const endpoint = router.getPreferredEndpoint('anthropic.claude-opus-4-5-20251101');

      expect(endpoint?.id).toBe('anthropic');
    });

    it('should return undefined when no endpoints available', () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;

      const router = new ModelRouter();
      const endpoint = router.getPreferredEndpoint('anthropic.claude-opus-4-5-20251101');

      expect(endpoint).toBeUndefined();
    });
  });

  describe('isModelSupported', () => {
    it('should return true when endpoint is available', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const router = new ModelRouter();

      expect(router.isModelSupported('anthropic.claude-opus-4-5-20251101')).toBe(true);
    });

    it('should return false when no endpoint is available', () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;

      const router = new ModelRouter();

      expect(router.isModelSupported('anthropic.claude-opus-4-5-20251101')).toBe(false);
    });
  });

  describe('custom routing config', () => {
    it('should use custom routing config', () => {
      const customConfig: ModelRoutingConfig[] = [
        {
          pattern: 'custom-*',
          protocol: 'anthropic',
          endpoints: ['anthropic'],
        },
      ];

      process.env.ANTHROPIC_API_KEY = 'test-key';

      const router = new ModelRouter(customConfig);

      expect(router.getProtocolForModel('custom-model')).toBe('anthropic');
      expect(router.getProtocolForModel('claude-opus-4-5-20251101')).toBeUndefined();
    });
  });

  describe('getModelRouter singleton', () => {
    it('should return same instance', () => {
      const router1 = getModelRouter();
      const router2 = getModelRouter();

      expect(router1).toBe(router2);
    });

    it('should reset singleton', () => {
      const router1 = getModelRouter();
      resetModelRouter();
      const router2 = getModelRouter();

      expect(router1).not.toBe(router2);
    });
  });
});
