/**
 * Jest test suite for LLM Provider Manager
 * Tests configuration loading, endpoint management, workload model resolution, and cost estimation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  getLLMProviderManager,
  resetLLMProviderManager,
  EndpointManager,
  getEndpointManager,
  resetEndpointManager,
  getWorkloadModelResolver,
  resetWorkloadModelResolver,
  getCachedConfig,
  clearConfigCache,
  loadLLMConfig,
  saveLLMConfig,
  validateConfig,
  DEFAULT_LLM_CONFIG,
  ConfigValidationError,
  type LLMConfig,
  type ModelTier,
} from '../../../../src/infra/llm/provider-manager/index.js';
import { clearCredentialsCache } from '../../../../src/infra/config/credentials-loader.js';
import * as agentRegistry from '../../../../src/infra/agents/agent-registry.js';
import * as runtimeConfig from '../../../../src/infra/config/runtime-config.js';

// Helper to get config path
const getConfigPath = () => path.join(os.homedir(), '.ponybunny', 'llm-config.json');

// Check if user config exists
const userConfigExists = () => fs.existsSync(getConfigPath());

describe('LLM Provider Manager', () => {
  // Store original env vars
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original env vars
    const envVars = [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION',
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_ENDPOINT',
      'OPENAI_COMPATIBLE_API_KEY',
      'OPENAI_COMPATIBLE_BASE_URL',
      'CUSTOM_OPENAI_API_KEY',
      'GOOGLE_CLOUD_PROJECT',
    ];
    for (const key of envVars) {
      originalEnv[key] = process.env[key];
    }

    // Reset all singletons and caches
    resetLLMProviderManager();
    resetEndpointManager();
    resetWorkloadModelResolver();
    clearConfigCache();
    clearCredentialsCache();
  });

  afterEach(() => {
    // Restore original env vars
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Reset singletons
    resetLLMProviderManager();
    resetEndpointManager();
    resetWorkloadModelResolver();
    clearConfigCache();
    clearCredentialsCache();
  });

  // ============================================
  // Config Loader Tests
  // ============================================
  describe('Config Loader', () => {
    it('should load default config when no file exists', () => {
      // Use a non-existent path
      const config = loadLLMConfig('/non/existent/path.json');

      expect(config).toBeDefined();
      expect(config.providers).toBeDefined();
      expect(config.models).toBeDefined();
      expect(config.tiers).toBeDefined();
      expect(config.workloads).toBeDefined();
      expect(config.defaults).toBeDefined();
    });

    it('should have required tiers in default config', () => {
      const config = DEFAULT_LLM_CONFIG;

      expect(config.tiers.simple).toBeDefined();
      expect(config.tiers.medium).toBeDefined();
      expect(config.tiers.complex).toBeDefined();
    });

    it('should have Claude models as primary in default tiers', () => {
      const config = DEFAULT_LLM_CONFIG;

      expect(config.tiers.simple.primary).toBe('anthropic.claude-haiku-4-5-20251001');
      expect(config.tiers.medium.primary).toBe('anthropic.claude-sonnet-4-5-20250929');
      expect(config.tiers.complex.primary).toBe('anthropic.claude-opus-4-5-20251101');
    });

    it('should load user config from ~/.ponybunny/llm-config.json if exists', () => {
      if (!userConfigExists()) {
        console.log('Skipping: User config does not exist');
        return;
      }

      const config = getCachedConfig();

      expect(config).toBeDefined();
      expect(config.providers).toBeDefined();
      expect(config.models).toBeDefined();
    });

    it('should validate config structure', () => {
      const validConfig: LLMConfig = {
        providers: {
          'test-endpoint': {
            enabled: true,
            protocol: 'anthropic',
            priority: 1,
          },
        },
        models: {
          'test-model': {
            displayName: 'Test Model',
            providers: ['test-endpoint'],
            costPer1kTokens: { input: 0.001, output: 0.002 },
          },
        },
        tiers: {
          simple: { primary: 'test-model' },
          medium: { primary: 'test-model' },
          complex: { primary: 'test-model' },
        },
        workloads: {
          'test-agent': { tier: 'simple' },
        },
        defaults: {
          timeout: 60000,
          maxTokens: 4096,
        },
      };

      expect(() => validateConfig(validConfig)).not.toThrow();
    });

    it('should reject invalid config', () => {
      const invalidConfig = {
        providers: {},
        // Missing required fields
      };

      expect(() => validateConfig(invalidConfig)).toThrow(ConfigValidationError);
    });

    it('should normalize provider-grouped models structure from config file', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-config-facts-'));
      const tempConfigPath = path.join(tempDir, 'llm-config.json');

      const groupedConfig = {
        providers: {
          openai: {
            enabled: true,
            protocol: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            priority: 1,
          },
        },
        models: {
          openai: {
          'openai.gpt-5.2': {
              displayName: 'GPT-5.2',
              endpoints: [
                { name: 'chat-completions', url: '/v1/chat/completions' },
                { name: 'responses', url: '/v1/responses' },
              ],
              costPer1kTokens: { input: 0.00175, output: 0.014 },
              maxContextTokens: 400000,
              maxOutputTokens: 128000,
              capabilities: {
                input: ['text', 'image'],
                output: ['text'],
              },
              features: ['function_calling', 'structured_outputs'],
            },
          },
        },
        providerAliases: {
          openai: {
            protocol: 'openai',
            providers: ['openai'],
          },
        },
        tiers: {
          simple: { primary: 'openai.gpt-5.2' },
          medium: { primary: 'openai.gpt-5.2' },
          complex: { primary: 'openai.gpt-5.2' },
        },
        workloads: {
          conversation: { tier: 'medium' },
        },
        defaults: {
          timeout: 120000,
          maxTokens: 4096,
        },
      };

      fs.writeFileSync(tempConfigPath, JSON.stringify(groupedConfig, null, 2), 'utf-8');

      const config = loadLLMConfig(tempConfigPath);
      const gpt = config.models['openai.gpt-5.2'];

      expect(gpt).toBeDefined();
      expect(gpt.providers).toContain('openai');
      expect(gpt.endpoints).toEqual([{ name: 'responses', url: '/v1/responses' }]);
      expect(gpt.maxOutputTokens).toBe(128000);
      expect(gpt.capabilities).toEqual(expect.arrayContaining(['text', 'vision', 'function-calling', 'json-mode']));
    });

    it('should treat explicitly configured providers as authoritative', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-config-providers-'));
      const tempConfigPath = path.join(tempDir, 'llm-config.json');

      const configPayload = {
        providers: {
          cpa: {
            enabled: true,
            protocol: 'openai',
            baseUrl: 'https://api.cpa.example/v1',
            priority: 1,
          },
        },
        models: {
          cpa: {
            'deepseek-v3.1': {
              displayName: 'DeepSeek V3.1',
              providers: ['cpa'],
              costPer1kTokens: { input: 0.001, output: 0.002 },
              maxContextTokens: 128000,
            },
          },
        },
        tiers: {
          simple: { primary: 'cpa.deepseek-v3.1' },
          medium: { primary: 'cpa.deepseek-v3.1' },
          complex: { primary: 'cpa.deepseek-v3.1' },
        },
        workloads: {
          conversation: { tier: 'medium' },
        },
        defaults: {
          timeout: 120000,
          maxTokens: 4096,
        },
      };

      fs.writeFileSync(tempConfigPath, JSON.stringify(configPayload, null, 2));

      const loaded = loadLLMConfig(tempConfigPath);
      expect(Object.keys(loaded.providers)).toEqual(['cpa']);
      expect(loaded.providers.cpa.enabled).toBe(true);
      expect(loaded.providers.anthropic).toBeUndefined();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should save models using provider-grouped structure', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-config-save-grouped-'));
      const tempConfigPath = path.join(tempDir, 'llm-config.json');

      const config = loadLLMConfig('/non/existent/path.json');
      saveLLMConfig(config, tempConfigPath);

      const saved = JSON.parse(fs.readFileSync(tempConfigPath, 'utf-8')) as Record<string, unknown>;
      const models = saved.models as Record<string, unknown>;
      const openaiGroup = models.openai as Record<string, unknown>;
      const openaiModel = openaiGroup['gpt-5.2'] as Record<string, unknown>;

      expect(models.openai).toBeDefined();
      expect(models.anthropic).toBeDefined();
      expect(openaiModel).toBeDefined();
      expect(openaiModel.providers).toBeUndefined();
      expect((models.anthropic as Record<string, unknown>)['claude-sonnet-4-5-20250929']).toBeDefined();
      expect(models['openai.gpt-5.2']).toBeUndefined();
    });
  });

  // ============================================
  // Endpoint Manager Tests
  // ============================================
  describe('EndpointManager', () => {
    it('should return singleton instance', () => {
      const manager1 = getEndpointManager();
      const manager2 = getEndpointManager();

      expect(manager1).toBe(manager2);
    });

    it('should get enabled endpoints', () => {
      const manager = getEndpointManager();
      const endpoints = manager.getEnabledEndpoints();

      expect(Array.isArray(endpoints)).toBe(true);
      // All returned endpoints should be enabled
      for (const endpoint of endpoints) {
        expect(endpoint.config.enabled).toBe(true);
      }
    });

    it('should sort endpoints by priority', () => {
      const manager = getEndpointManager();
      const endpoints = manager.getEnabledEndpoints();

      if (endpoints.length > 1) {
        for (let i = 1; i < endpoints.length; i++) {
          expect(endpoints[i].config.priority).toBeGreaterThanOrEqual(
            endpoints[i - 1].config.priority
          );
        }
      }
    });

    it('should check credentials from environment variables', () => {
      // Without env var
      delete process.env.ANTHROPIC_API_KEY;
      clearCredentialsCache();
      resetEndpointManager();

      const managerWithoutKey = new EndpointManager();
      // May or may not have credentials depending on credentials.json
      // Just verify the method works without throwing
      managerWithoutKey.hasCredentials('anthropic');

      // With env var
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const managerWithKey = new EndpointManager();
      expect(managerWithKey.hasCredentials('anthropic')).toBe(true);
    });

    it('should check endpoint availability', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const manager = new EndpointManager();

      const isAvailable = await manager.isEndpointAvailable('anthropic');
      expect(typeof isAvailable).toBe('boolean');
    });

    it('should get endpoint health status', async () => {
      const manager = new EndpointManager();
      const health = await manager.getEndpointHealth('anthropic');

      expect(health).toBeDefined();
      expect(health.endpointId).toBe('anthropic');
      expect(typeof health.available).toBe('boolean');
      expect(typeof health.hasCredentials).toBe('boolean');
      expect(typeof health.enabled).toBe('boolean');
      expect(typeof health.lastChecked).toBe('number');
    });

    it('should mark endpoint as failed', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const manager = new EndpointManager();

      // Initially get health status
      await manager.getEndpointHealth('anthropic');

      // Mark as failed
      manager.markEndpointFailed('anthropic', 'Test error');

      const healthAfter = await manager.getEndpointHealth('anthropic');
      expect(healthAfter.available).toBe(false);
      expect(healthAfter.lastError).toBe('Test error');
    });

    it('should clear health cache', async () => {
      const manager = new EndpointManager();

      // Populate cache
      await manager.getEndpointHealth('anthropic');

      // Clear cache
      manager.clearHealthCache('anthropic');

      // Should recheck (no error means it works)
      const health = await manager.getEndpointHealth('anthropic');
      expect(health).toBeDefined();
    });

    it('should get available endpoints for model', async () => {
      const manager = getEndpointManager();
      const endpoints = await manager.getAvailableEndpointsForModel('anthropic.claude-sonnet-4-5-20250929');

      expect(Array.isArray(endpoints)).toBe(true);
    });

    it('should resolve provider-prefixed model selector to scoped endpoints', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const manager = getEndpointManager();
      const endpoints = await manager.getAvailableEndpointsForModel('openai.gpt-5.2');

      expect(Array.isArray(endpoints)).toBe(true);
      expect(endpoints).toContain('openai');
    });

    it('should skip endpoints marked unavailable by persisted endpoint probe health', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      const config = getCachedConfig();
      config.providers.openai.enabled = true;
      config.providers.openai.health = {
        available: false,
        lastCheckedAt: new Date().toISOString(),
        lastError: '502 Bad Gateway',
      };

      const manager = new EndpointManager();
      const endpoints = await manager.getAvailableEndpointsForModel('openai.gpt-5.2');

      expect(endpoints).not.toContain('openai');
    });

    it('should skip model-endpoint pairs marked unavailable by persisted model probe health', async () => {
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

      const manager = new EndpointManager();
      const endpoints = await manager.getAvailableEndpointsForModel('openai.gpt-5.2');

      expect(endpoints).not.toContain('openai');
    });

    it('should resolve credentials', () => {
      process.env.ANTHROPIC_API_KEY = 'test-api-key';
      const manager = new EndpointManager();

      const credentials = manager.resolveCredentials('anthropic');

      expect(credentials).toBeDefined();
      expect(credentials?.apiKey).toBe('test-api-key');
    });

    it('should support custom endpoint ids from llm-config using endpoint requiredEnvVars', () => {
      const config = getCachedConfig();
      config.providers['custom-openai-endpoint'] = {
        enabled: true,
        protocol: 'openai',
        priority: 10,
        requiredEnvVars: ['CUSTOM_OPENAI_API_KEY'],
      };

      process.env.CUSTOM_OPENAI_API_KEY = 'custom-key';

      const manager = new EndpointManager();
      expect(manager.hasCredentials('custom-openai-endpoint')).toBe(true);
    });
  });

  // ============================================
  // Agent Model Resolver Tests
  // ============================================
  describe('WorkloadModelResolver', () => {
    it('should return singleton instance', () => {
      const resolver1 = getWorkloadModelResolver();
      const resolver2 = getWorkloadModelResolver();

      expect(resolver1).toBe(resolver2);
    });

    it('should get model for known workloads', () => {
      const resolver = getWorkloadModelResolver();
      const knownWorkloads = [
        'input-analysis',
        'planning',
        'execution',
        'verification',
        'response-generation',
        'conversation',
      ];

      for (const workloadId of knownWorkloads) {
        const model = resolver.getModelForWorkload(workloadId);
        expect(model).toBeDefined();
        expect(typeof model).toBe('string');
      }
    });

    it('should return medium tier model for unknown workloads', () => {
      const resolver = getWorkloadModelResolver();
      const config = getCachedConfig();

      const model = resolver.getModelForWorkload('unknown-workload-xyz');
      expect(model).toBe(config.tiers.medium.primary);
    });

    it('should ignore legacy workload model overrides and use tier primary', () => {
      const resolver = getWorkloadModelResolver();
      const config = getCachedConfig();
      const previousExecution = config.workloads.execution;

      config.workloads.execution = {
        ...(config.workloads.execution || {}),
        tier: 'simple',
        primary: 'openai.gpt-5.2',
        llm_model: 'openai.gpt-5.2',
      } as unknown as typeof config.workloads.execution;

      const model = resolver.getModelForWorkload('execution');
      expect(model).toBe(config.tiers.simple.primary);

      if (previousExecution) {
        config.workloads.execution = previousExecution;
      } else {
        delete config.workloads.execution;
      }
    });

    it('should prioritize agent configured model over tier model', () => {
      const resolver = getWorkloadModelResolver();
      const registrySpy = jest.spyOn(agentRegistry, 'getGlobalAgentRegistry').mockReturnValue({
        getAgent: (id: string) => {
          if (id !== 'planning') {
            return undefined;
          }
          return {
            config: {
              runner: {
                config: {
                  model_hint: 'openai.gpt-5.2',
                },
              },
            },
          };
        },
      } as unknown as ReturnType<typeof agentRegistry.getGlobalAgentRegistry>);

      try {
        const chain = resolver.getFallbackChain('planning');
        expect(chain[0]).toBe('openai.gpt-5.2');
      } finally {
        registrySpy.mockRestore();
      }
    });

    it('should prioritize runtime ponybunny model override over user, agent and tier', () => {
      const resolver = getWorkloadModelResolver();
      const runtimeSpy = jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue({
        ...runtimeConfig.DEFAULT_RUNTIME_CONFIG,
        agent: {
          ...runtimeConfig.DEFAULT_RUNTIME_CONFIG.agent,
          modelOverrides: {
            planning: 'openai.gpt-5.2',
          },
        },
      });

      const registrySpy = jest.spyOn(agentRegistry, 'getGlobalAgentRegistry').mockReturnValue({
        getAgent: () => ({
          config: {
            runner: {
              config: {
                model_hint: 'anthropic.claude-opus-4-5-20251101',
              },
            },
          },
        }),
      } as unknown as ReturnType<typeof agentRegistry.getGlobalAgentRegistry>);

      try {
        const chain = resolver.getSelectionChainForWorkload('planning', 'google-ai-studio.gemini-2.0-pro');
        expect(chain[0]).toBe('openai.gpt-5.2');
      } finally {
        runtimeSpy.mockRestore();
        registrySpy.mockRestore();
      }
    });

    it('should treat runtime AUTO override as disabled and fall back to next priority', () => {
      const resolver = getWorkloadModelResolver();
      const runtimeSpy = jest.spyOn(runtimeConfig, 'loadRuntimeConfig').mockReturnValue({
        ...runtimeConfig.DEFAULT_RUNTIME_CONFIG,
        agent: {
          ...runtimeConfig.DEFAULT_RUNTIME_CONFIG.agent,
          modelOverrides: {
            planning: 'AUTO',
          },
        },
      });

      const registrySpy = jest.spyOn(agentRegistry, 'getGlobalAgentRegistry').mockReturnValue({
        getAgent: () => ({
          config: {
            runner: {
              config: {
                model_hint: 'openai.gpt-5.3',
              },
            },
          },
        }),
      } as unknown as ReturnType<typeof agentRegistry.getGlobalAgentRegistry>);

      try {
        const chain = resolver.getSelectionChainForWorkload('planning');
        expect(chain[0]).toBe('openai.gpt-5.3');
      } finally {
        runtimeSpy.mockRestore();
        registrySpy.mockRestore();
      }
    });

    it('should get model for tiers', () => {
      const resolver = getWorkloadModelResolver();
      const tiers: ModelTier[] = ['simple', 'medium', 'complex'];

      for (const tier of tiers) {
        const model = resolver.getModelForTier(tier);
        expect(model).toBeDefined();
        expect(typeof model).toBe('string');
      }
    });

    it('should get fallback chain for workloads', () => {
      const resolver = getWorkloadModelResolver();

      const chain = resolver.getFallbackChain('planning');

      expect(Array.isArray(chain)).toBe(true);
      expect(chain.length).toBeGreaterThan(0);
      // First item should be the primary model
      expect(chain[0]).toBe(resolver.getModelForWorkload('planning'));
    });

    it('should get fallback chain for tiers', () => {
      const resolver = getWorkloadModelResolver();
      const config = getCachedConfig();

      const chain = resolver.getFallbackChainForTier('complex');

      expect(Array.isArray(chain)).toBe(true);
      expect(chain[0]).toBe(config.tiers.complex.primary);
      // Should include fallback models
      if (config.tiers.complex.fallback) {
        for (const fallback of config.tiers.complex.fallback) {
          expect(chain).toContain(fallback);
        }
      }
    });

    it('should get tier for workload', () => {
      const resolver = getWorkloadModelResolver();

      expect(resolver.getTierForWorkload('input-analysis')).toBe('simple');
      expect(resolver.getTierForWorkload('planning')).toBe('complex');
      expect(resolver.getTierForWorkload('execution')).toBe('medium');
    });

    it('should check if workload is configured', () => {
      const resolver = getWorkloadModelResolver();

      expect(resolver.isWorkloadConfigured('planning')).toBe(true);
      expect(resolver.isWorkloadConfigured('non-existent-workload')).toBe(false);
    });

    it('should get all workload IDs', () => {
      const resolver = getWorkloadModelResolver();
      const workloadIds = resolver.getAllWorkloadIds();

      expect(Array.isArray(workloadIds)).toBe(true);
      expect(workloadIds).toContain('planning');
      expect(workloadIds).toContain('execution');
    });

    it('should estimate cost correctly', () => {
      const resolver = getWorkloadModelResolver();

      // Claude Opus 4.5: $0.015/1k input, $0.075/1k output
      const cost = resolver.estimateCost('anthropic.claude-opus-4-5-20251101', 1000, 1000);
      expect(cost).toBeCloseTo(0.015 + 0.075, 4);

      // GPT-4o: $0.005/1k input, $0.015/1k output
      const gptCost = resolver.estimateCost('gpt-4o', 1000, 1000);
      expect(gptCost).toBeCloseTo(0.005 + 0.015, 4);
    });

    it('should return default cost for unknown models', () => {
      const resolver = getWorkloadModelResolver();

      const cost = resolver.estimateCost('unknown-model', 1000, 1000);
      expect(cost).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Provider Manager Tests
  // ============================================
  describe('LLMProviderManager', () => {
    it('should return singleton instance', () => {
      const manager1 = getLLMProviderManager();
      const manager2 = getLLMProviderManager();

      expect(manager1).toBe(manager2);
    });

    it('should get config', () => {
      const manager = getLLMProviderManager();
      const config = manager.getConfig();

      expect(config).toBeDefined();
      expect(config.providers).toBeDefined();
      expect(config.models).toBeDefined();
    });

    it('should get enabled endpoints', () => {
      const manager = getLLMProviderManager();
      const endpoints = manager.getEnabledEndpoints();

      expect(Array.isArray(endpoints)).toBe(true);
    });

    it('should get available models', () => {
      const manager = getLLMProviderManager();
      const models = manager.getAvailableModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);

      // Each model should have id and config
      for (const model of models) {
        expect(model.id).toBeDefined();
        expect(model.config).toBeDefined();
        expect(model.config.displayName).toBeDefined();
      }
    });

    it('should get model endpoints', () => {
      const manager = getLLMProviderManager();

      const endpoints = manager.getModelEndpoints('anthropic.claude-sonnet-4-5-20250929');
      expect(Array.isArray(endpoints)).toBe(true);
      expect(endpoints).toContain('anthropic');
    });

    it('should get model for workload', () => {
      const manager = getLLMProviderManager();

      const model = manager.getModelForWorkload('planning');
      expect(model).toBeDefined();
      expect(typeof model).toBe('string');
    });

    it('should get model for tier', () => {
      const manager = getLLMProviderManager();

      const simpleModel = manager.getModelForTier('simple');
      const mediumModel = manager.getModelForTier('medium');
      const complexModel = manager.getModelForTier('complex');

      expect(simpleModel).toBeDefined();
      expect(mediumModel).toBeDefined();
      expect(complexModel).toBeDefined();
    });

    it('should get fallback chain', () => {
      const manager = getLLMProviderManager();

      const chain = manager.getFallbackChain('planning');

      expect(Array.isArray(chain)).toBe(true);
      expect(chain.length).toBeGreaterThan(0);
    });

    it('should estimate cost', () => {
      const manager = getLLMProviderManager();

      const cost = manager.estimateCost('anthropic.claude-opus-4-5-20251101', 1000, 500);
      expect(cost).toBeGreaterThan(0);
    });

    it('should get model config', () => {
      const manager = getLLMProviderManager();

      const config = manager.getModelConfig('anthropic.claude-sonnet-4-5-20250929');

      expect(config).toBeDefined();
      expect(config?.displayName).toBe('Claude Sonnet 4.5');
      expect(config?.costPer1kTokens).toBeDefined();
    });

    it('should expose maxOutputTokens from model facts for OpenAI models', () => {
      const manager = getLLMProviderManager();
      const config = manager.getModelConfig('openai.gpt-5.2');

      expect(config).toBeDefined();
      expect(config?.maxOutputTokens).toBe(128000);
    });

    it('should check if model is supported', () => {
      const manager = getLLMProviderManager();

      expect(manager.isModelSupported('anthropic.claude-sonnet-4-5-20250929')).toBe(true);
      expect(manager.isModelSupported('non-existent-model')).toBe(false);
    });

    it('should get all workload IDs', () => {
      const manager = getLLMProviderManager();
      const workloadIds = manager.getAllWorkloadIds();

      expect(Array.isArray(workloadIds)).toBe(true);
      expect(workloadIds.length).toBeGreaterThan(0);
    });

    it('should reload config', async () => {
      const manager = getLLMProviderManager();

      // Should not throw
      await manager.reloadConfig();

      const config = manager.getConfig();
      expect(config).toBeDefined();
    });

    it('should prioritize user selected model over agent and tier models', async () => {
      const manager = getLLMProviderManager();
      const completeWithFallbackSpy = jest
        .spyOn(manager as unknown as { completeWithFallback: (...args: unknown[]) => Promise<unknown> }, 'completeWithFallback')
        .mockResolvedValue({ content: 'ok', model: 'openai.gpt-5.2', tokensUsed: 1 });
      const resolver = (manager as unknown as {
        workloadModelResolver: { getSelectionChainForWorkload: (w: string, m?: string) => string[] };
      }).workloadModelResolver;
      const selectionSpy = jest
        .spyOn(resolver, 'getSelectionChainForWorkload')
        .mockReturnValue(['openai.gpt-5.2', 'anthropic.claude-sonnet-4-5-20250929']);

      try {
        await manager.complete('planning', [{ role: 'user', content: 'test' }], {
          model: 'openai.gpt-5.2',
        });
        expect(completeWithFallbackSpy).toHaveBeenCalledWith(
          ['openai.gpt-5.2', 'anthropic.claude-sonnet-4-5-20250929'],
          [{ role: 'user', content: 'test' }],
          expect.objectContaining({ model: 'openai.gpt-5.2' }),
          'responses'
        );
      } finally {
        selectionSpy.mockRestore();
        completeWithFallbackSpy.mockRestore();
      }
    });
  });

  // ============================================
  // Integration Tests with User Config
  // ============================================
  describe('Integration with User Config', () => {
    it('should load user config if exists', () => {
      if (!userConfigExists()) {
        console.log('Skipping: User config does not exist at', getConfigPath());
        return;
      }

      const config = getCachedConfig();

      console.log('Loaded user config:');
      console.log(`  - Providers: ${Object.keys(config.providers).length}`);
      console.log(`  - Models: ${Object.keys(config.models).length}`);
      console.log(`  - Workloads: ${Object.keys(config.workloads).length}`);

      expect(config).toBeDefined();
    });

    it('should resolve models for all configured workloads', () => {
      const resolver = getWorkloadModelResolver();
      const workloadIds = resolver.getAllWorkloadIds();

      console.log('Workload model resolution:');
      for (const workloadId of workloadIds) {
        const model = resolver.getModelForWorkload(workloadId);
        const tier = resolver.getTierForWorkload(workloadId);
        console.log(`  - ${workloadId}: tier=${tier}, model=${model}`);

        expect(model).toBeDefined();
      }
    });

    it('should have valid fallback chains for all tiers', () => {
      const resolver = getWorkloadModelResolver();
      const tiers: ModelTier[] = ['simple', 'medium', 'complex'];

      console.log('Tier fallback chains:');
      for (const tier of tiers) {
        const chain = resolver.getFallbackChainForTier(tier);
        console.log(`  - ${tier}: ${chain.join(' → ')}`);

        expect(chain.length).toBeGreaterThan(0);
      }
    });

    it('should check endpoint availability', async () => {
      const manager = getEndpointManager();
      const endpoints = manager.getEnabledEndpoints();

      console.log('Endpoint availability:');
      for (const endpoint of endpoints) {
        const isAvailable = await manager.isEndpointAvailable(endpoint.id);
        const hasCredentials = manager.hasCredentials(endpoint.id);
        console.log(
          `  - ${endpoint.id}: available=${isAvailable}, credentials=${hasCredentials}`
        );
      }
    });
  });

  // ============================================
  // Cost Estimation Tests
  // ============================================
  describe('Cost Estimation', () => {
    const testCases = [
      { model: 'anthropic.claude-haiku-4-5-20251001', input: 1000, output: 500, expectedMin: 0.001 },
      { model: 'anthropic.claude-sonnet-4-5-20250929', input: 1000, output: 500, expectedMin: 0.005 },
      { model: 'anthropic.claude-opus-4-5-20251101', input: 1000, output: 500, expectedMin: 0.05 },
      { model: 'gpt-4o', input: 1000, output: 500, expectedMin: 0.01 },
      { model: 'gpt-4o-mini', input: 1000, output: 500, expectedMin: 0.0001 },
      { model: 'gemini-2.0-flash', input: 1000, output: 500, expectedMin: 0.0001 },
    ];

    for (const tc of testCases) {
      it(`should estimate cost for ${tc.model}`, () => {
        const resolver = getWorkloadModelResolver();
        const cost = resolver.estimateCost(tc.model, tc.input, tc.output);

        expect(cost).toBeGreaterThanOrEqual(tc.expectedMin);
        console.log(`  ${tc.model}: $${cost.toFixed(6)} (${tc.input} in, ${tc.output} out)`);
      });
    }
  });
});
