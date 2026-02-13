import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { LLMConfig, LLMEndpointConfig, LLMModelConfig, LLMTierConfig, LLMAgentConfig, LLMDefaultsConfig, ModelTier } from './types.js';
import { ConfigValidationError } from './types.js';

/**
 * Get the PonyBunny config directory path
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.ponybunny');
}

/**
 * Get the LLM config file path
 */
export function getLLMConfigPath(): string {
  return path.join(getConfigDir(), 'llm-config.json');
}

/**
 * Get the JSON Schema file path
 */
export function getSchemaPath(): string {
  return path.join(getConfigDir(), 'llm-config.schema.json');
}

/**
 * Default configuration used when no config file exists
 */
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  endpoints: {
    'anthropic-direct': {
      enabled: true,
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1/messages',
      priority: 1,
      rateLimit: { requestsPerMinute: 60 },
    },
    'aws-bedrock': {
      enabled: false,
      protocol: 'anthropic',
      region: 'us-east-1',
      priority: 2,
      costMultiplier: 1.0,
    },
    'openai-direct': {
      enabled: true,
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      priority: 1,
      rateLimit: { requestsPerMinute: 60 },
    },
    'openai-compatible': {
      enabled: false,
      protocol: 'openai',
      priority: 3,
    },
    'azure-openai': {
      enabled: false,
      protocol: 'openai',
      priority: 2,
    },
    'google-ai-studio': {
      enabled: true,
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      priority: 1,
    },
    'google-vertex-ai': {
      enabled: false,
      protocol: 'gemini',
      priority: 2,
    },
    codex: {
      enabled: true,
      protocol: 'codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      priority: 1,
    },
  },
  models: {
    'claude-haiku-4-5-20251001': {
      displayName: 'Claude Haiku 4.5',
      endpoints: ['anthropic-direct', 'aws-bedrock'],
      costPer1kTokens: { input: 0.001, output: 0.005 },
      maxContextTokens: 200000,
      capabilities: ['text', 'vision'],
    },
    'claude-sonnet-4-5-20250929': {
      displayName: 'Claude Sonnet 4.5',
      endpoints: ['anthropic-direct', 'aws-bedrock'],
      costPer1kTokens: { input: 0.003, output: 0.015 },
      maxContextTokens: 200000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
    'claude-opus-4-5-20251101': {
      displayName: 'Claude Opus 4.5',
      endpoints: ['anthropic-direct', 'aws-bedrock'],
      costPer1kTokens: { input: 0.015, output: 0.075 },
      maxContextTokens: 200000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
    'gpt-5.2': {
      displayName: 'GPT-5.2',
      endpoints: ['openai-direct'],
      costPer1kTokens: { input: 0.01, output: 0.03 },
      maxContextTokens: 128000,
      capabilities: ['text', 'vision', 'function-calling', 'json-mode'],
    },
    'gpt-5.2-codex': {
      displayName: 'GPT-5.2 Codex (OAuth)',
      endpoints: ['codex'],
      costPer1kTokens: { input: 0.01, output: 0.03 },
      maxContextTokens: 128000,
      capabilities: ['text', 'vision', 'function-calling', 'json-mode'],
    },
    'gemini-2.0-flash': {
      displayName: 'Gemini 2.0 Flash',
      endpoints: ['google-ai-studio', 'google-vertex-ai'],
      costPer1kTokens: { input: 0.00035, output: 0.0014 },
      maxContextTokens: 1000000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
    'gemini-2.0-pro': {
      displayName: 'Gemini 2.0 Pro',
      endpoints: ['google-ai-studio', 'google-vertex-ai'],
      costPer1kTokens: { input: 0.00125, output: 0.005 },
      maxContextTokens: 2000000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
  },
  tiers: {
    simple: {
      primary: 'claude-haiku-4-5-20251001',
      fallback: ['gpt-5.2', 'gemini-2.0-flash'],
    },
    medium: {
      primary: 'claude-sonnet-4-5-20250929',
      fallback: ['gpt-5.2', 'gemini-2.0-pro', 'claude-haiku-4-5-20251001'],
    },
    complex: {
      primary: 'claude-opus-4-5-20251101',
      fallback: ['gpt-5.2', 'claude-sonnet-4-5-20250929'],
    },
  },
  agents: {
    'input-analysis': {
      tier: 'simple',
      description: 'Intent and emotion analysis',
    },
    planning: {
      tier: 'complex',
      description: 'Goal decomposition and planning',
    },
    execution: {
      tier: 'medium',
      primary: 'claude-sonnet-4-5-20250929',
      description: 'ReAct execution loop',
    },
    verification: {
      tier: 'medium',
      description: 'Result verification',
    },
    'response-generation': {
      tier: 'simple',
      description: 'Natural language response',
    },
    conversation: {
      tier: 'medium',
      description: 'Conversation agent',
    },
  },
  defaults: {
    timeout: 120000,
    maxTokens: 4096,
    maxRetries: 2,
    retryDelayMs: 1000,
    temperature: 0.7,
  },
};

/**
 * JSON Schema for validation (embedded for cases where schema file is missing)
 */
const EMBEDDED_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/llm-config.schema.json',
  title: 'PonyBunny LLM Configuration',
  type: 'object',
  required: ['endpoints', 'models', 'tiers', 'agents', 'defaults'],
  properties: {
    $schema: { type: 'string' },
    endpoints: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['enabled', 'protocol', 'priority'],
        properties: {
          enabled: { type: 'boolean' },
          protocol: { type: 'string', enum: ['anthropic', 'openai', 'gemini', 'codex'] },
          baseUrl: { type: 'string' },
          priority: { type: 'integer', minimum: 1 },
          rateLimit: {
            type: 'object',
            properties: {
              requestsPerMinute: { type: 'integer', minimum: 1 },
              tokensPerMinute: { type: 'integer', minimum: 1 },
            },
          },
          region: { type: 'string' },
          costMultiplier: { type: 'number', minimum: 0 },
        },
      },
    },
    models: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['displayName', 'endpoints', 'costPer1kTokens'],
        properties: {
          displayName: { type: 'string' },
          endpoints: { type: 'array', items: { type: 'string' }, minItems: 1 },
          costPer1kTokens: {
            type: 'object',
            required: ['input', 'output'],
            properties: {
              input: { type: 'number', minimum: 0 },
              output: { type: 'number', minimum: 0 },
            },
          },
          maxContextTokens: { type: 'integer', minimum: 1 },
          capabilities: {
            type: 'array',
            items: { type: 'string', enum: ['text', 'vision', 'function-calling', 'json-mode'] },
          },
        },
      },
    },
    tiers: {
      type: 'object',
      required: ['simple', 'medium', 'complex'],
      properties: {
        simple: { $ref: '#/$defs/TierConfig' },
        medium: { $ref: '#/$defs/TierConfig' },
        complex: { $ref: '#/$defs/TierConfig' },
      },
    },
    agents: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['simple', 'medium', 'complex'] },
          primary: { type: 'string' },
          fallback: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
      },
    },
    defaults: {
      type: 'object',
      properties: {
        timeout: { type: 'integer', minimum: 1000 },
        maxTokens: { type: 'integer', minimum: 1 },
        maxRetries: { type: 'integer', minimum: 0 },
        retryDelayMs: { type: 'integer', minimum: 0 },
        temperature: { type: 'number', minimum: 0, maximum: 2 },
      },
    },
  },
  $defs: {
    TierConfig: {
      type: 'object',
      required: ['primary'],
      properties: {
        primary: { type: 'string' },
        fallback: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

/**
 * Create AJV validator instance with draft 2020-12 support
 */
function createValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/**
 * Load and parse JSON Schema
 */
function loadSchema(): object {
  const schemaPath = getSchemaPath();

  const patchSchema = (schema: any): any => {
    const patchEnum = (maybeEnum: unknown) => {
      if (Array.isArray(maybeEnum) && !maybeEnum.includes('codex')) {
        maybeEnum.push('codex');
      }
    };

    try {
      patchEnum(schema?.properties?.endpoints?.additionalProperties?.properties?.protocol?.enum);
    } catch {
    }

    try {
      patchEnum(schema?.$defs?.EndpointConfig?.properties?.protocol?.enum);
    } catch {
    }

    return schema;
  };

  try {
    if (fs.existsSync(schemaPath)) {
      const content = fs.readFileSync(schemaPath, 'utf-8');
      return patchSchema(JSON.parse(content));
    }
  } catch (error) {
    console.warn(`[ConfigLoader] Failed to load schema file, using embedded schema: ${(error as Error).message}`);
  }

  return patchSchema(EMBEDDED_SCHEMA);
}

/**
 * Validate configuration against JSON Schema
 */
export function validateConfig(config: unknown): LLMConfig {
  const ajv = createValidator();
  const schema = loadSchema();
  const validate = ajv.compile(schema);

  if (!validate(config)) {
    const errors = (validate.errors || []).map((err) => ({
      path: err.instancePath || '/',
      message: err.message || 'Unknown validation error',
    }));

    throw new ConfigValidationError(
      `Invalid LLM configuration: ${errors.map((e: { path: string; message: string }) => `${e.path}: ${e.message}`).join('; ')}`,
      errors
    );
  }

  return config as LLMConfig;
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

/**
 * Load LLM configuration from file
 * Falls back to default configuration if file doesn't exist
 */
export function loadLLMConfig(configPath?: string): LLMConfig {
  const filePath = configPath || getLLMConfigPath();

  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[ConfigLoader] Config file not found at ${filePath}, using defaults`);
      return { ...DEFAULT_LLM_CONFIG };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Merge with defaults to ensure all required fields exist
    const merged = deepMerge(DEFAULT_LLM_CONFIG as unknown as Record<string, unknown>, parsed) as unknown as LLMConfig;

    // Validate the merged configuration
    return validateConfig(merged);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }

    console.warn(`[ConfigLoader] Failed to load config: ${(error as Error).message}, using defaults`);
    return { ...DEFAULT_LLM_CONFIG };
  }
}

/**
 * Save LLM configuration to file
 */
export function saveLLMConfig(config: LLMConfig, configPath?: string): void {
  const filePath = configPath || getLLMConfigPath();
  const configDir = path.dirname(filePath);

  // Validate before saving
  validateConfig(config);

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  // Add schema reference
  const configWithSchema = {
    $schema: './llm-config.schema.json',
    ...config,
  };

  fs.writeFileSync(filePath, JSON.stringify(configWithSchema, null, 2), {
    mode: 0o600,
  });
}

/**
 * Check if config file exists
 */
export function configFileExists(configPath?: string): boolean {
  const filePath = configPath || getLLMConfigPath();
  return fs.existsSync(filePath);
}

// ============================================
// Cached Config Loader
// ============================================

let configCache: LLMConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000; // 5 seconds

/**
 * Get configuration with caching
 */
export function getCachedConfig(): LLMConfig {
  const now = Date.now();

  if (configCache === null || now - cacheTimestamp > CACHE_TTL_MS) {
    configCache = loadLLMConfig();
    cacheTimestamp = now;
  }

  return configCache;
}

/**
 * Clear the configuration cache
 */
export function clearConfigCache(): void {
  configCache = null;
  cacheTimestamp = 0;
}

/**
 * Force reload configuration
 */
export function reloadConfig(): LLMConfig {
  clearConfigCache();
  return getCachedConfig();
}

// ============================================
// Config Accessors
// ============================================

/**
 * Get endpoint configuration by ID
 */
export function getEndpointConfig(endpointId: string): LLMEndpointConfig | undefined {
  const config = getCachedConfig();
  return config.endpoints[endpointId];
}

/**
 * Get model configuration by ID
 */
export function getModelConfig(modelId: string): LLMModelConfig | undefined {
  const config = getCachedConfig();
  return config.models[modelId];
}

/**
 * Get tier configuration
 */
export function getTierConfig(tier: ModelTier): LLMTierConfig {
  const config = getCachedConfig();
  return config.tiers[tier];
}

/**
 * Get agent configuration by ID
 */
export function getAgentConfig(agentId: string): LLMAgentConfig | undefined {
  const config = getCachedConfig();
  return config.agents[agentId];
}

/**
 * Get default configuration values
 */
export function getDefaultsConfig(): LLMDefaultsConfig {
  const config = getCachedConfig();
  return config.defaults;
}
