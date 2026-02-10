import {
  ENDPOINT_CONFIGS,
  getEndpointConfig,
  getAllEndpointConfigs,
  getAvailableEndpoints,
  getEndpointsByProtocol,
} from '../../../../src/infra/llm/endpoints/endpoint-registry.js';

describe('EndpointRegistry', () => {
  describe('ENDPOINT_CONFIGS', () => {
    it('should have all expected endpoints', () => {
      expect(Object.keys(ENDPOINT_CONFIGS)).toEqual([
        'anthropic-direct',
        'aws-bedrock',
        'openai-direct',
        'azure-openai',
        'openai-compatible',
        'google-ai-studio',
        'google-vertex-ai',
      ]);
    });

    it('should have correct protocol for anthropic endpoints', () => {
      expect(ENDPOINT_CONFIGS['anthropic-direct'].protocol).toBe('anthropic');
      expect(ENDPOINT_CONFIGS['aws-bedrock'].protocol).toBe('anthropic');
    });

    it('should have correct protocol for openai endpoints', () => {
      expect(ENDPOINT_CONFIGS['openai-direct'].protocol).toBe('openai');
      expect(ENDPOINT_CONFIGS['azure-openai'].protocol).toBe('openai');
      expect(ENDPOINT_CONFIGS['openai-compatible'].protocol).toBe('openai');
    });

    it('should have correct protocol for gemini endpoints', () => {
      expect(ENDPOINT_CONFIGS['google-ai-studio'].protocol).toBe('gemini');
      expect(ENDPOINT_CONFIGS['google-vertex-ai'].protocol).toBe('gemini');
    });

    it('should have required env vars for each endpoint', () => {
      expect(ENDPOINT_CONFIGS['anthropic-direct'].requiredEnvVars).toContain('ANTHROPIC_API_KEY');
      expect(ENDPOINT_CONFIGS['openai-direct'].requiredEnvVars).toContain('OPENAI_API_KEY');
      expect(ENDPOINT_CONFIGS['openai-compatible'].requiredEnvVars).toContain('OPENAI_COMPATIBLE_API_KEY');
      expect(ENDPOINT_CONFIGS['google-ai-studio'].requiredEnvVars).toContain('GEMINI_API_KEY');
      expect(ENDPOINT_CONFIGS['aws-bedrock'].requiredEnvVars).toContain('AWS_ACCESS_KEY_ID');
      expect(ENDPOINT_CONFIGS['azure-openai'].requiredEnvVars).toContain('AZURE_OPENAI_API_KEY');
    });
  });

  describe('getEndpointConfig', () => {
    it('should return config for valid endpoint', () => {
      const config = getEndpointConfig('anthropic-direct');

      expect(config.id).toBe('anthropic-direct');
      expect(config.protocol).toBe('anthropic');
    });

    it('should throw for unknown endpoint', () => {
      expect(() => getEndpointConfig('unknown' as any)).toThrow('Unknown endpoint: unknown');
    });
  });

  describe('getAllEndpointConfigs', () => {
    it('should return all endpoint configs', () => {
      const configs = getAllEndpointConfigs();

      expect(configs.length).toBe(7);
      expect(configs.map(c => c.id)).toContain('anthropic-direct');
      expect(configs.map(c => c.id)).toContain('openai-direct');
      expect(configs.map(c => c.id)).toContain('openai-compatible');
    });
  });

  describe('getAvailableEndpoints', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return empty array when no credentials set', () => {
      // Clear all relevant env vars
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_ENDPOINT;
      delete process.env.GOOGLE_CLOUD_PROJECT;

      const available = getAvailableEndpoints();

      expect(available.length).toBe(0);
    });

    it('should return anthropic-direct when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const available = getAvailableEndpoints();

      expect(available.map(c => c.id)).toContain('anthropic-direct');
    });

    it('should return aws-bedrock when AWS credentials are set', () => {
      process.env.AWS_ACCESS_KEY_ID = 'test-id';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

      const available = getAvailableEndpoints();

      expect(available.map(c => c.id)).toContain('aws-bedrock');
    });
  });

  describe('getEndpointsByProtocol', () => {
    it('should return anthropic endpoints sorted by priority', () => {
      const endpoints = getEndpointsByProtocol('anthropic');

      expect(endpoints.length).toBe(2);
      expect(endpoints[0].id).toBe('anthropic-direct'); // priority 1
      expect(endpoints[1].id).toBe('aws-bedrock'); // priority 2
    });

    it('should return openai endpoints sorted by priority', () => {
      const endpoints = getEndpointsByProtocol('openai');

      expect(endpoints.length).toBe(3);
      expect(endpoints[0].id).toBe('openai-direct'); // priority 1
      expect(endpoints[1].id).toBe('azure-openai'); // priority 2
      expect(endpoints[2].id).toBe('openai-compatible'); // priority 3
    });

    it('should return gemini endpoints sorted by priority', () => {
      const endpoints = getEndpointsByProtocol('gemini');

      expect(endpoints.length).toBe(2);
      expect(endpoints[0].id).toBe('google-ai-studio');
      expect(endpoints[1].id).toBe('google-vertex-ai');
    });

    it('should return empty array for unknown protocol', () => {
      const endpoints = getEndpointsByProtocol('unknown');

      expect(endpoints.length).toBe(0);
    });
  });
});
