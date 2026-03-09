import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type {
  LLMConfig,
  LLMEndpointConfig,
  LLMModelConfig,
  LLMTierConfig,
  LLMWorkloadConfig,
  LLMDefaultsConfig,
  ModelTier,
} from './types.js';
import { ConfigValidationError } from './types.js';
import { getConfigDir as getGlobalConfigDir } from '../../config/config-paths.js';

/**
 * Get the PonyBunny config directory path
 */
export function getConfigDir(): string {
  return getGlobalConfigDir();
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
  providers: {
    anthropic: {
      enabled: true,
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1/messages',
      type: 'api',
      priority: 1,
      rateLimit: { requestsPerMinute: 60 },
    },
    'aws-bedrock': {
      enabled: true,
      protocol: 'anthropic',
      region: 'us-east-1',
      type: 'api',
      priority: 2,
      costMultiplier: 1.0,
    },
    openai: {
      enabled: true,
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      type: 'api',
      priority: 1,
      rateLimit: { requestsPerMinute: 60 },
    },
    'openai-compatible': {
      enabled: false,
      protocol: 'openai',
      type: 'api',
      priority: 3,
    },
    'azure-openai': {
      enabled: false,
      protocol: 'openai',
      type: 'api',
      priority: 2,
    },
    'google-ai-studio': {
      enabled: true,
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      type: 'api',
      priority: 1,
    },
    'google-vertex-ai': {
      enabled: false,
      protocol: 'gemini',
      type: 'api',
      priority: 2,
    },
    'openai-codex': {
      enabled: true,
      protocol: 'codex',
      baseUrl: 'https://chatgpt.com/backend-api',
      type: 'oauth',
      priority: 1,
    },
  },
  models: {
    'anthropic.claude-haiku-4-5-20251001': {
      displayName: 'Claude Haiku 4.5',
      costPer1kTokens: { input: 0.001, output: 0.005 },
      maxContextTokens: 200000,
      capabilities: ['text', 'vision'],
    },
    'anthropic.claude-sonnet-4-5-20250929': {
      displayName: 'Claude Sonnet 4.5',
      costPer1kTokens: { input: 0.003, output: 0.015 },
      maxContextTokens: 200000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
    'anthropic.claude-opus-4-5-20251101': {
      displayName: 'Claude Opus 4.5',
      costPer1kTokens: { input: 0.015, output: 0.075 },
      maxContextTokens: 200000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
    'openai.gpt-5.2': {
      displayName: 'GPT-5.2',
      endpoints: [
        { name: 'responses', url: '/v1/responses' },
      ],
      costPer1kTokens: { input: 0.01, output: 0.03 },
      maxContextTokens: 128000,
      disallowedParams: ['temperature', 'top_p', 'top_k', 'top_n'],
      capabilities: ['text', 'vision', 'function-calling', 'json-mode'],
    },
    'openai-codex.gpt-5.2-codex': {
      displayName: 'GPT-5.2 Codex (OAuth)',
      endpoints: [{ name: 'responses', url: '/v1/responses' }],
      costPer1kTokens: { input: 0.01, output: 0.03 },
      maxContextTokens: 128000,
      disallowedParams: ['temperature', 'top_p', 'top_k', 'top_n'],
      capabilities: ['text', 'vision', 'function-calling', 'json-mode'],
    },
    'google-ai-studio.gemini-2.0-flash': {
      displayName: 'Gemini 2.0 Flash',
      costPer1kTokens: { input: 0.00035, output: 0.0014 },
      maxContextTokens: 1000000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
    'google-ai-studio.gemini-2.0-pro': {
      displayName: 'Gemini 2.0 Pro',
      costPer1kTokens: { input: 0.00125, output: 0.005 },
      maxContextTokens: 2000000,
      capabilities: ['text', 'vision', 'function-calling'],
    },
  },
  providerAliases: {
    anthropic: {
      protocol: 'anthropic',
      providers: ['anthropic'],
    },
    aws: {
      protocol: 'anthropic',
      providers: ['aws-bedrock'],
    },
    openai: {
      protocol: 'openai',
      providers: ['openai'],
    },
    azure: {
      protocol: 'openai',
      providers: ['azure-openai'],
    },
    'openai-compatible': {
      protocol: 'openai',
      providers: ['openai-compatible'],
    },
    'openai-codex': {
      protocol: 'codex',
      providers: ['openai-codex'],
    },
    codex: {
      protocol: 'codex',
      providers: ['openai-codex'],
    },
    gemini: {
      protocol: 'gemini',
      providers: ['google-ai-studio'],
    },
    vertex: {
      protocol: 'gemini',
      providers: ['google-vertex-ai'],
    },
  },
  tiers: {
    simple: {
      primary: 'anthropic.claude-haiku-4-5-20251001',
      fallback: ['openai.gpt-5.2', 'google-ai-studio.gemini-2.0-flash'],
    },
    medium: {
      primary: 'anthropic.claude-sonnet-4-5-20250929',
      fallback: [
        'openai.gpt-5.2',
        'google-ai-studio.gemini-2.0-pro',
        'anthropic.claude-haiku-4-5-20251001',
      ],
    },
    complex: {
      primary: 'anthropic.claude-opus-4-5-20251101',
      fallback: ['openai.gpt-5.2', 'anthropic.claude-sonnet-4-5-20250929'],
    },
  },
  workloads: {
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
  required: ['providers', 'models', 'tiers', 'workloads', 'defaults'],
  properties: {
    $schema: { type: 'string' },
    providers: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['enabled', 'protocol', 'priority'],
        properties: {
          enabled: { type: 'boolean' },
          protocol: { type: 'string', enum: ['anthropic', 'openai', 'gemini', 'codex'] },
          type: { type: 'string', enum: ['api', 'oauth'] },
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
      },
    },
    providerAliases: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['protocol', 'providers'],
        properties: {
          protocol: { type: 'string', enum: ['anthropic', 'openai', 'gemini', 'codex'] },
          providers: { type: 'array', items: { type: 'string' }, minItems: 1 },
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
    workloads: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['simple', 'medium', 'complex'] },
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

type JsonMap = Record<string, unknown>;

type ModelFactsEntry = {
  displayName?: string;
  providers?: string[];
  endpoints?: Array<{ name?: string; url?: string }>;
  costPer1kTokens?: { input?: number; output?: number };
  maxContextTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningTokenSupport?: boolean;
  reasoningEfforts?: string[];
  resongingEfforts?: string[];
  capabilities?: unknown;
  parameterSupport?: {
    temperature?: boolean;
    topP?: boolean;
    topK?: boolean;
    topN?: boolean;
  };
  disallowedParams?: string[];
  features?: string[];
  tools?: string[];
};

function inferProviderIdFromModelKey(
  modelId: string,
  providers?: Record<string, LLMEndpointConfig>,
  aliases?: LLMConfig['providerAliases']
): string | undefined {
  const dotIndex = modelId.indexOf('.');
  if (dotIndex <= 0 || dotIndex === modelId.length - 1) {
    return undefined;
  }

  const candidate = modelId.slice(0, dotIndex);
  if (!providers && !aliases) {
    return candidate;
  }

  if (providers?.[candidate] || aliases?.[candidate]) {
    return candidate;
  }

  return undefined;
}

type ModelCapabilityEntry = NonNullable<LLMModelConfig['capabilities']>[number];
type OpenAIEndpointEntry = NonNullable<LLMModelConfig['endpoints']>[number];

const MODEL_FACTS_CANDIDATE_PATHS = [
  path.join(process.cwd(), 'docs', 'llm-facts', 'models.json'),
  path.join(process.cwd(), 'dist', 'docs', 'llm-facts', 'models.json'),
];

function isJsonMap(value: unknown): value is JsonMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModelFactsEntry(value: unknown): value is ModelFactsEntry {
  if (!isJsonMap(value)) {
    return false;
  }

  return 'displayName' in value || 'costPer1kTokens' in value || 'providers' in value || 'endpoints' in value;
}

function resolveProviderIds(
  group: string | undefined,
  entry: ModelFactsEntry,
  providers: Record<string, LLMEndpointConfig>,
  aliases?: LLMConfig['providerAliases']
): string[] {
  if (Array.isArray(entry.providers) && entry.providers.length > 0) {
    return entry.providers;
  }

  if (group && providers[group]) {
    return [group];
  }

  if (group && aliases?.[group]?.providers?.length) {
    return aliases[group].providers;
  }

  const lower = (group || '').toLowerCase();
  const byProtocol = Object.entries(providers)
    .filter(([, cfg]) => cfg.protocol === lower)
    .map(([providerId]) => providerId);

  return byProtocol;
}

function toModelCapabilities(entry: ModelFactsEntry): LLMModelConfig['capabilities'] {
  if (Array.isArray(entry.capabilities)) {
    return entry.capabilities as LLMModelConfig['capabilities'];
  }

  if (!isJsonMap(entry.capabilities)) {
    return undefined;
  }

  const input = Array.isArray(entry.capabilities.input) ? entry.capabilities.input : [];
  const output = Array.isArray(entry.capabilities.output) ? entry.capabilities.output : [];
  const features = Array.isArray(entry.features) ? entry.features : [];
  const set = new Set<ModelCapabilityEntry>();

  if (input.includes('text') || output.includes('text')) {
    set.add('text');
  }
  if (input.includes('image') || output.includes('image')) {
    set.add('vision');
  }
  if (features.includes('function_calling')) {
    set.add('function-calling');
  }
  if (features.includes('structured_outputs')) {
    set.add('json-mode');
  }

  return set.size > 0 ? Array.from(set) : undefined;
}

function sanitizeEndpoints(entry: ModelFactsEntry): LLMModelConfig['endpoints'] {
  if (!Array.isArray(entry.endpoints)) {
    return undefined;
  }

  const endpoints = entry.endpoints
    .filter(endpoint => endpoint && endpoint.name !== 'chat-completions' && typeof endpoint.name === 'string' && typeof endpoint.url === 'string')
    .map(endpoint => ({
      name: endpoint.name as OpenAIEndpointEntry['name'],
      url: endpoint.url as string,
    }));

  return endpoints.length > 0 ? endpoints : undefined;
}

function normalizeModelEntry(
  modelId: string,
  entry: ModelFactsEntry,
  group: string | undefined,
  providers: Record<string, LLMEndpointConfig>,
  aliases?: LLMConfig['providerAliases']
): LLMModelConfig | undefined {
  const resolvedProviders = resolveProviderIds(group, entry, providers, aliases);
  const inferredProvider = inferProviderIdFromModelKey(modelId, providers, aliases);
  const finalProviders = resolvedProviders.length > 0
    ? resolvedProviders
    : (inferredProvider ? [inferredProvider] : []);

  const reasoningEfforts = entry.reasoningEfforts ?? entry.resongingEfforts;
  const capabilitiesMatrix = isJsonMap(entry.capabilities)
    ? {
      input: Array.isArray(entry.capabilities.input) ? entry.capabilities.input.filter(item => typeof item === 'string') as string[] : undefined,
      output: Array.isArray(entry.capabilities.output) ? entry.capabilities.output.filter(item => typeof item === 'string') as string[] : undefined,
    }
    : undefined;

  return {
    displayName: entry.displayName || modelId,
    ...(finalProviders.length > 0 ? { providers: finalProviders } : {}),
    endpoints: sanitizeEndpoints(entry),
    costPer1kTokens: {
      input: entry.costPer1kTokens?.input ?? 0,
      output: entry.costPer1kTokens?.output ?? 0,
    },
    maxContextTokens: entry.maxContextTokens ?? entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    contextWindow: entry.contextWindow,
    reasoningTokenSupport: entry.reasoningTokenSupport,
    reasoningEfforts: Array.isArray(reasoningEfforts) ? reasoningEfforts : undefined,
    capabilitiesMatrix,
    parameterSupport: entry.parameterSupport,
    disallowedParams: Array.isArray(entry.disallowedParams) ? entry.disallowedParams : undefined,
    features: Array.isArray(entry.features) ? entry.features : undefined,
    tools: Array.isArray(entry.tools) ? entry.tools : undefined,
    capabilities: toModelCapabilities(entry),
  };
}

function normalizeModels(
  models: unknown,
  providers: Record<string, LLMEndpointConfig>,
  aliases?: LLMConfig['providerAliases']
): Record<string, LLMModelConfig> {
  if (!isJsonMap(models)) {
    return {};
  }

  const normalized: Record<string, LLMModelConfig> = {};

  for (const [key, value] of Object.entries(models)) {
    if (isModelFactsEntry(value)) {
      const model = normalizeModelEntry(key, value, undefined, providers, aliases);
      if (model) {
        normalized[key] = model;
      }
      continue;
    }

    if (!isJsonMap(value)) {
      continue;
    }

    for (const [nestedModelId, nestedValue] of Object.entries(value)) {
      if (!isModelFactsEntry(nestedValue)) {
        continue;
      }

      const normalizedModelId = inferProviderIdFromModelKey(nestedModelId, providers, aliases)
        ? nestedModelId
        : `${key}.${nestedModelId}`;
      const model = normalizeModelEntry(normalizedModelId, nestedValue, key, providers, aliases);
      if (model) {
        normalized[normalizedModelId] = model;
      }
    }
  }

  return normalized;
}

function loadModelsFacts(): unknown {
  for (const candidate of MODEL_FACTS_CANDIDATE_PATHS) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf-8'));
    } catch {
      continue;
    }
  }

  return undefined;
}

const LEGACY_PROVIDER_ID_MAP: Record<string, string> = {
  'anthropic-direct': 'anthropic',
  'openai-direct': 'openai',
  codex: 'openai-codex',
};

function remapProviderId(providerId: string): string {
  return LEGACY_PROVIDER_ID_MAP[providerId] || providerId;
}

function remapProviderReferenceInModelId(modelId: string): string {
  const dotIndex = modelId.indexOf('.');
  if (dotIndex <= 0 || dotIndex === modelId.length - 1) {
    return modelId;
  }

  const providerId = modelId.slice(0, dotIndex);
  const suffix = modelId.slice(dotIndex + 1);
  const remapped = remapProviderId(providerId);
  if (remapped === providerId) {
    return modelId;
  }

  return `${remapped}.${suffix}`;
}

function remapProviderReferencesInModels(models: Record<string, LLMModelConfig>): Record<string, LLMModelConfig> {
  const remapped: Record<string, LLMModelConfig> = {};

  for (const [modelId, modelConfig] of Object.entries(models)) {
    const nextModelId = remapProviderReferenceInModelId(modelId);
    const nextProviders = Array.isArray(modelConfig.providers)
      ? modelConfig.providers.map(remapProviderId)
      : modelConfig.providers;

    remapped[nextModelId] = {
      ...modelConfig,
      ...(nextProviders ? { providers: nextProviders } : {}),
    };
  }

  return remapped;
}

function remapProviderReferencesInWorkloads(workloads: LLMConfig['workloads']): LLMConfig['workloads'] {
  const remapped: LLMConfig['workloads'] = {};

  for (const [workloadId, workload] of Object.entries(workloads || {})) {
    remapped[workloadId] = {
      ...workload,
    };
  }

  return remapped;
}

function remapLegacyProviderIds(config: Partial<LLMConfig>): Partial<LLMConfig> {
  const providers = config.providers
    ? Object.fromEntries(
        Object.entries(config.providers).map(([providerId, providerConfig]) => [
          remapProviderId(providerId),
          providerConfig,
        ])
      )
    : undefined;

  const providerAliases = config.providerAliases
    ? Object.fromEntries(
        Object.entries(config.providerAliases).map(([aliasId, aliasConfig]) => [
          aliasId,
          {
            ...aliasConfig,
            providers: aliasConfig.providers.map(remapProviderId),
          },
        ])
      )
    : undefined;

  return {
    ...config,
    ...(providers ? { providers } : {}),
    ...(providerAliases ? { providerAliases } : {}),
    ...(config.models ? { models: remapProviderReferencesInModels(config.models) } : {}),
    ...(config.workloads ? { workloads: remapProviderReferencesInWorkloads(config.workloads) } : {}),
    ...(config.tiers
      ? {
          tiers: {
            ...config.tiers,
            simple: {
              ...config.tiers.simple,
              primary: remapProviderReferenceInModelId(config.tiers.simple.primary),
              ...(Array.isArray(config.tiers.simple.fallback)
                ? { fallback: config.tiers.simple.fallback.map(remapProviderReferenceInModelId) }
                : {}),
            },
            medium: {
              ...config.tiers.medium,
              primary: remapProviderReferenceInModelId(config.tiers.medium.primary),
              ...(Array.isArray(config.tiers.medium.fallback)
                ? { fallback: config.tiers.medium.fallback.map(remapProviderReferenceInModelId) }
                : {}),
            },
            complex: {
              ...config.tiers.complex,
              primary: remapProviderReferenceInModelId(config.tiers.complex.primary),
              ...(Array.isArray(config.tiers.complex.fallback)
                ? { fallback: config.tiers.complex.fallback.map(remapProviderReferenceInModelId) }
                : {}),
            },
          },
        }
      : {}),
  };
}

function normalizeExternalConfig(raw: unknown, defaults: LLMConfig): Partial<LLMConfig> {
  if (!isJsonMap(raw)) {
    return {};
  }

  const providers = isJsonMap(raw.providers)
    ? (raw.providers as Record<string, LLMEndpointConfig>)
    : defaults.providers;
  const aliases = isJsonMap(raw.providerAliases)
    ? (raw.providerAliases as LLMConfig['providerAliases'])
    : defaults.providerAliases;

  const normalizedModels = normalizeModels(raw.models, providers, aliases);

  const normalized = {
    ...(raw as Partial<LLMConfig>),
    models: normalizedModels,
  };

  return remapLegacyProviderIds(normalized);
}

function buildDefaultConfigWithFacts(base: LLMConfig): LLMConfig {
  const factsRaw = loadModelsFacts();
  const factsModels = normalizeModels(factsRaw, base.providers, base.providerAliases);
  if (Object.keys(factsModels).length === 0) {
    return base;
  }

  return {
    ...base,
    models: {
      ...base.models,
      ...factsModels,
    },
  };
}

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
      patchEnum(schema?.properties?.providers?.additionalProperties?.properties?.protocol?.enum);
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
  const defaultConfig = buildDefaultConfigWithFacts(DEFAULT_LLM_CONFIG);

  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[ConfigLoader] Config file not found at ${filePath}, using defaults`);
      return defaultConfig;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    const normalizedParsed = normalizeExternalConfig(parsed, defaultConfig);

    // Merge with defaults to ensure all required fields exist
    const merged = deepMerge(defaultConfig as unknown as Record<string, unknown>, normalizedParsed as unknown as Record<string, unknown>) as unknown as LLMConfig;

    if (isJsonMap((parsed as Record<string, unknown>).providers) && normalizedParsed.providers) {
      merged.providers = normalizedParsed.providers;
    }

    if (isJsonMap((parsed as Record<string, unknown>).providerAliases) && normalizedParsed.providerAliases) {
      merged.providerAliases = normalizedParsed.providerAliases;
    }

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
  const serializedModels = serializeModelsForFile(config.models, config.providers, config.providerAliases);
  const configWithSchema = {
    $schema: 'https://ponybunny.dho.ai/schemas/llm-config.schema.json',
    ...config,
    models: serializedModels,
  };

  fs.writeFileSync(filePath, JSON.stringify(configWithSchema, null, 2), {
    mode: 0o600,
  });
}

function serializeModelsForFile(
  models: Record<string, LLMModelConfig>,
  providers: Record<string, LLMEndpointConfig>,
  aliases?: LLMConfig['providerAliases']
): Record<string, unknown> {
  const grouped: Record<string, Record<string, LLMModelConfig>> = {};
  const passthrough: Record<string, LLMModelConfig> = {};

  for (const [modelId, modelConfig] of Object.entries(models)) {
    const { providers: _ignoredProviders, ...persistedModelConfig } = modelConfig;
    const providerId = inferProviderIdFromModelKey(modelId, providers, aliases);
    if (!providerId) {
      passthrough[modelId] = persistedModelConfig;
      continue;
    }

    const suffix = modelId.slice(providerId.length + 1);
    if (!suffix) {
      passthrough[modelId] = persistedModelConfig;
      continue;
    }

    if (!grouped[providerId]) {
      grouped[providerId] = {};
    }
    grouped[providerId][suffix] = persistedModelConfig;
  }

  return {
    ...passthrough,
    ...grouped,
  };
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
  return config.providers[endpointId];
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
 * Get workload configuration by ID
 */
export function getWorkloadConfig(workloadId: string): LLMWorkloadConfig | undefined {
  const config = getCachedConfig();
  return config.workloads[workloadId];
}

/**
 * Get default configuration values
 */
export function getDefaultsConfig(): LLMDefaultsConfig {
  const config = getCachedConfig();
  return config.defaults;
}
