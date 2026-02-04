import { loadModelTierConfig, DEFAULT_MODEL_TIER_CONFIG } from '../../../src/scheduler/model-selector/model-tier-config.js';

describe('model-tier-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PONY_MODEL_SIMPLE;
    delete process.env.PONY_MODEL_MEDIUM;
    delete process.env.PONY_MODEL_COMPLEX;
    delete process.env.PONY_MODEL_SIMPLE_FALLBACK;
    delete process.env.PONY_MODEL_MEDIUM_FALLBACK;
    delete process.env.PONY_MODEL_COMPLEX_FALLBACK;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('DEFAULT_MODEL_TIER_CONFIG', () => {
    test('should have simple tier config (Claude-first)', () => {
      expect(DEFAULT_MODEL_TIER_CONFIG.simple.primary).toBe('claude-haiku-4-5-20251001');
      expect(DEFAULT_MODEL_TIER_CONFIG.simple.fallback).toBe('gpt-5.2');
      expect(DEFAULT_MODEL_TIER_CONFIG.simple.temperature).toBe(0.2);
    });

    test('should have medium tier config (Claude-first)', () => {
      expect(DEFAULT_MODEL_TIER_CONFIG.medium.primary).toBe('claude-sonnet-4-5-20250929');
      expect(DEFAULT_MODEL_TIER_CONFIG.medium.fallback).toBe('gpt-5.2');
      expect(DEFAULT_MODEL_TIER_CONFIG.medium.temperature).toBe(0.2);
    });

    test('should have complex tier config (Claude Opus 4.5)', () => {
      expect(DEFAULT_MODEL_TIER_CONFIG.complex.primary).toBe('claude-opus-4-5-20251101');
      expect(DEFAULT_MODEL_TIER_CONFIG.complex.fallback).toBe('gpt-5.2');
      expect(DEFAULT_MODEL_TIER_CONFIG.complex.temperature).toBe(0.3);
    });
  });

  describe('loadModelTierConfig', () => {
    test('should return default config when no env vars set', () => {
      const config = loadModelTierConfig();

      expect(config.simple.primary).toBe('claude-haiku-4-5-20251001');
      expect(config.medium.primary).toBe('claude-sonnet-4-5-20250929');
      expect(config.complex.primary).toBe('claude-opus-4-5-20251101');
    });

    test('should override simple model from env', () => {
      process.env.PONY_MODEL_SIMPLE = 'custom-simple-model';

      const config = loadModelTierConfig();

      expect(config.simple.primary).toBe('custom-simple-model');
      expect(config.simple.fallback).toBe('gpt-5.2');
      expect(config.medium.primary).toBe('claude-sonnet-4-5-20250929');
      expect(config.complex.primary).toBe('claude-opus-4-5-20251101');
    });

    test('should override medium model from env', () => {
      process.env.PONY_MODEL_MEDIUM = 'custom-medium-model';

      const config = loadModelTierConfig();

      expect(config.simple.primary).toBe('claude-haiku-4-5-20251001');
      expect(config.medium.primary).toBe('custom-medium-model');
      expect(config.medium.fallback).toBe('gpt-5.2');
      expect(config.complex.primary).toBe('claude-opus-4-5-20251101');
    });

    test('should override complex model from env', () => {
      process.env.PONY_MODEL_COMPLEX = 'custom-complex-model';

      const config = loadModelTierConfig();

      expect(config.simple.primary).toBe('claude-haiku-4-5-20251001');
      expect(config.medium.primary).toBe('claude-sonnet-4-5-20250929');
      expect(config.complex.primary).toBe('custom-complex-model');
      expect(config.complex.fallback).toBe('gpt-5.2');
    });

    test('should override all models from env', () => {
      process.env.PONY_MODEL_SIMPLE = 'env-simple';
      process.env.PONY_MODEL_MEDIUM = 'env-medium';
      process.env.PONY_MODEL_COMPLEX = 'env-complex';

      const config = loadModelTierConfig();

      expect(config.simple.primary).toBe('env-simple');
      expect(config.medium.primary).toBe('env-medium');
      expect(config.complex.primary).toBe('env-complex');
    });

    test('should preserve other config properties when overriding', () => {
      process.env.PONY_MODEL_SIMPLE = 'custom-model';

      const config = loadModelTierConfig();

      expect(config.simple.temperature).toBe(0.2);
      expect(config.simple.fallback).toBe('gpt-5.2');
    });

    test('should override fallback models from env', () => {
      process.env.PONY_MODEL_SIMPLE_FALLBACK = 'custom-simple-fallback';
      process.env.PONY_MODEL_COMPLEX_FALLBACK = 'custom-complex-fallback';

      const config = loadModelTierConfig();

      expect(config.simple.fallback).toBe('custom-simple-fallback');
      expect(config.complex.fallback).toBe('custom-complex-fallback');
    });
  });
});
