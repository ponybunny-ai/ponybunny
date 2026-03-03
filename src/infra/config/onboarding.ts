import * as fs from 'fs';
import * as path from 'path';
import { getPromptSeedRelativePaths } from '../prompts/template-loader.js';
import { getConfigDir as getGlobalConfigDir, getInstallDir } from './config-paths.js';
import { resolveRuntimeConfigFromEnvironment } from './runtime-config.js';

/**
 * Get the PonyBunny config directory path
 */
export function getConfigDir(): string {
  return getGlobalConfigDir();
}

/**
 * Template for credentials.schema.json
 */
export const CREDENTIALS_SCHEMA_TEMPLATE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/credentials.schema.json',
  title: 'PonyBunny Credentials',
  description: 'Credentials configuration for LLM providers',
  type: 'object',
  properties: {
    $schema: { type: 'string', description: 'JSON Schema reference' },
    providers: {
      type: 'object',
      description: 'Per-endpoint credential configuration',
      additionalProperties: { $ref: '#/$defs/EndpointCredential' },
    },
  },
  additionalProperties: false,
  $defs: {
    EndpointCredential: {
      type: 'object',
      description: 'Credentials for a specific endpoint',
      properties: {
        apiKey: {
          type: 'string',
          description: 'API key for the endpoint (Anthropic, OpenAI, Google AI Studio, Azure)',
        },
        accessKeyId: { type: 'string', description: 'AWS Access Key ID (for AWS Bedrock)' },
        secretAccessKey: { type: 'string', description: 'AWS Secret Access Key (for AWS Bedrock)' },
        region: {
          type: 'string',
          description: 'AWS region (for AWS Bedrock) or Google Cloud region (for Vertex AI)',
        },
        endpoint: { type: 'string', description: 'Azure OpenAI endpoint URL' },
        projectId: { type: 'string', description: 'Google Cloud Project ID (for Vertex AI)' },
        baseUrl: { type: 'string', description: 'Override the default base URL for this endpoint' },
      },
      additionalProperties: false,
    },
  },
};

/**
 * Template for credentials.json (no sensitive data)
 */
export const CREDENTIALS_TEMPLATE = {
  $schema: 'https://ponybunny.dho.ai/schemas/credentials.schema.json',
  providers: {
    anthropic: {
      apiKey: '',
      baseUrl: '',
    },
    'aws-bedrock': {
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
      baseUrl: '',
    },
    openai: {
      apiKey: '',
      baseUrl: '',
    },
    'openai-compatible': {
      apiKey: '',
      baseUrl: '',
    },
    'azure-openai': {
      apiKey: '',
      endpoint: '',
      baseUrl: '',
    },
    'openai-codex': {
      baseUrl: '',
    },
    'google-ai-studio': {
      apiKey: '',
      baseUrl: '',
    },
    'google-vertex-ai': {
      projectId: '',
      region: '',
      baseUrl: '',
    },
  },
};

/**
 * Template for llm-config.schema.json
 */
export const LLM_CONFIG_SCHEMA_TEMPLATE = {
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
        anyOf: [
          { $ref: '#/$defs/ModelConfig' },
          {
            type: 'object',
            additionalProperties: { $ref: '#/$defs/ModelConfig' },
          },
        ],
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
          llm_model: { type: 'string' },
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
    ModelConfig: {
      type: 'object',
      required: ['displayName', 'costPer1kTokens'],
      properties: {
        displayName: { type: 'string' },
        providers: { type: 'array', items: { type: 'string' }, minItems: 1 },
        endpoints: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'url'],
            properties: {
              name: {
                type: 'string',
                enum: [
                  'responses',
                  'realtime',
                  'assistants',
                  'batch',
                  'fine-tuning',
                  'embeddings',
                  'image-generation',
                  'videos',
                  'image-edit',
                  'speech-generation',
                  'transcription',
                  'translation',
                  'moderation',
                ],
              },
              url: { type: 'string' },
            },
          },
          minItems: 1,
        },
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
          anyOf: [
            {
              type: 'array',
              items: { type: 'string', enum: ['text', 'vision', 'function-calling', 'json-mode'] },
            },
            {
              type: 'object',
              properties: {
                input: { type: 'array', items: { type: 'string' } },
                output: { type: 'array', items: { type: 'string' } },
              },
            },
          ],
        },
      },
    },
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

const DEFAULT_LLM_CONFIG_TEMPLATE = {
  $schema: 'https://ponybunny.dho.ai/schemas/llm-config.schema.json',

  providers: {
    'anthropic-direct': {
      enabled: false,
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
      enabled: false,
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      priority: 1,
      rateLimit: { requestsPerMinute: 60 },
    },
    'openai-compatible': {
      enabled: false,
      protocol: 'openai',
      baseUrl: '',
      priority: 3,
      rateLimit: { requestsPerMinute: 60 },
    },
    'azure-openai': {
      enabled: false,
      protocol: 'openai',
      priority: 2,
    },
    'google-ai-studio': {
      enabled: false,
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
      enabled: false,
      protocol: 'codex',
      priority: 1,
    },
  },

  models: {
    openai: {
      'gpt-5.2': {
        displayName: 'GPT-5.2',
        providers: ['openai-direct', 'azure-openai', 'openai-compatible'],
        endpoints: [{ name: 'responses', url: '/v1/responses' }],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 128000,
        capabilities: ['text', 'vision', 'function-calling', 'json-mode'],
      },
      'gpt-5-mini': {
        displayName: 'GPT-5 Mini',
        providers: ['openai-direct', 'azure-openai', 'openai-compatible'],
        endpoints: [{ name: 'responses', url: '/v1/responses' }],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 128000,
        capabilities: ['text', 'vision', 'function-calling', 'json-mode'],
      },
      'gpt-5-nano': {
        displayName: 'GPT-5 Nano',
        providers: ['openai-direct', 'azure-openai', 'openai-compatible'],
        endpoints: [{ name: 'responses', url: '/v1/responses' }],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 128000,
        capabilities: ['text', 'vision', 'function-calling', 'json-mode'],
      },
      'gpt-5.3-codex': {
        displayName: 'GPT-5.3 Codex',
        providers: ['codex'],
        endpoints: [{ name: 'responses', url: '/v1/responses' }],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 128000,
        capabilities: ['text', 'function-calling'],
      },
    },
    anthropic: {
      'claude-opus-4-6': {
        displayName: 'Claude Opus 4.6',
        providers: ['anthropic-direct'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 200000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'claude-sonnet-4-6': {
        displayName: 'Claude Sonnet 4.6',
        providers: ['anthropic-direct'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 200000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'claude-haiku-4-5-20251001': {
        displayName: 'Claude Haiku 4.5 (20251001)',
        providers: ['anthropic-direct'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 200000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'anthropic.claude-opus-4-6-v1': {
        displayName: 'Anthropic Claude Opus 4.6 (Bedrock)',
        providers: ['aws-bedrock'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 200000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'anthropic.claude-sonnet-4-6': {
        displayName: 'Anthropic Claude Sonnet 4.6 (Bedrock)',
        providers: ['aws-bedrock'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 200000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'anthropic.claude-haiku-4-5-20251001-v1:0': {
        displayName: 'Anthropic Claude Haiku 4.5 (Bedrock)',
        providers: ['aws-bedrock'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 200000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'claude-haiku-4-5@20251001': {
        displayName: 'Claude Haiku 4.5 @20251001 (Vertex)',
        providers: ['google-vertex-ai'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 200000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
    },
    gemini: {
      'gemini-3.1-pro-preview': {
        displayName: 'Gemini 3.1 Pro Preview',
        providers: ['google-ai-studio'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 2000000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'gemini-3-flash-preview': {
        displayName: 'Gemini 3 Flash Preview',
        providers: ['google-ai-studio'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 1000000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
      'gemini-3-pro-preview': {
        displayName: 'Gemini 3 Pro Preview',
        providers: ['google-ai-studio'],
        costPer1kTokens: { input: 0, output: 0 },
        maxContextTokens: 2000000,
        capabilities: ['text', 'vision', 'function-calling'],
      },
    },
  },

  providerAliases: {
    anthropic: {
      protocol: 'anthropic',
      providers: ['anthropic-direct'],
    },
    aws: {
      protocol: 'anthropic',
      providers: ['aws-bedrock'],
    },
    openai: {
      protocol: 'openai',
      providers: ['openai-direct'],
    },
    azure: {
      protocol: 'openai',
      providers: ['azure-openai'],
    },
    'openai-compatible': {
      protocol: 'openai',
      providers: ['openai-compatible'],
    },
    codex: {
      protocol: 'codex',
      providers: ['codex'],
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
      fallback: ['openai.gpt-5-mini', 'gemini.gemini-3-flash-preview'],
    },
    medium: {
      primary: 'anthropic.claude-sonnet-4-6',
      fallback: ['openai.gpt-5.2', 'gemini.gemini-3-pro-preview', 'anthropic.claude-haiku-4-5-20251001'],
    },
    complex: {
      primary: 'anthropic.claude-opus-4-6',
      fallback: ['openai.gpt-5.2', 'gemini.gemini-3.1-pro-preview', 'anthropic.claude-sonnet-4-6'],
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
      llm_model: 'openai.gpt-5.2',
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
      llm_model: 'openai.gpt-5-mini',
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

type LlmConfigTemplate = typeof DEFAULT_LLM_CONFIG_TEMPLATE;

function isLlmConfigTemplate(value: unknown): value is LlmConfigTemplate {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<LlmConfigTemplate>;
  return (
    typeof candidate.$schema === 'string'
    && typeof candidate.providers === 'object'
    && candidate.providers !== null
    && typeof candidate.models === 'object'
    && candidate.models !== null
    && typeof candidate.tiers === 'object'
    && candidate.tiers !== null
    && typeof candidate.workloads === 'object'
    && candidate.workloads !== null
    && typeof candidate.defaults === 'object'
    && candidate.defaults !== null
  );
}

function getLlmConfigTemplateSourceCandidates(): string[] {
  const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
  const entryDir = entryPoint ? path.dirname(entryPoint) : undefined;

  const entryCandidates = entryDir
    ? [
      path.join(entryDir, '..', 'llm-config.example.json'),
      path.join(entryDir, '..', '..', 'llm-config.example.json'),
      path.join(entryDir, '..', '..', '..', 'llm-config.example.json'),
      path.join(entryDir, '..', 'docs', 'openai-compatible', 'examples', 'llm-config.example.json'),
      path.join(entryDir, '..', '..', 'docs', 'openai-compatible', 'examples', 'llm-config.example.json'),
    ]
    : [];

  return [
    path.join(process.cwd(), 'llm-config.example.json'),
    path.join(process.cwd(), 'docs', 'openai-compatible', 'examples', 'llm-config.example.json'),
    ...entryCandidates,
  ];
}

function loadLlmConfigTemplateFromExample(): LlmConfigTemplate | undefined {
  const visited = new Set<string>();
  const candidates = getLlmConfigTemplateSourceCandidates();

  for (const candidate of candidates) {
    if (visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);

    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (isLlmConfigTemplate(parsed)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getLlmFactsSourceCandidates(): string[] {
  const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
  const entryDir = entryPoint ? path.dirname(entryPoint) : undefined;

  const entryCandidates = entryDir
    ? [
      path.join(entryDir, '..', 'docs', 'llm-facts', 'models.json'),
      path.join(entryDir, '..', '..', 'docs', 'llm-facts', 'models.json'),
      path.join(entryDir, '..', '..', '..', 'docs', 'llm-facts', 'models.json'),
    ]
    : [];

  return [
    path.join(process.cwd(), 'docs', 'llm-facts', 'models.json'),
    path.join(process.cwd(), 'dist', 'docs', 'llm-facts', 'models.json'),
    ...entryCandidates,
  ];
}

function sanitizeModelFact(modelId: string, entry: unknown): Record<string, unknown> | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {
    displayName: typeof entry.displayName === 'string' ? entry.displayName : modelId,
    costPer1kTokens: {
      input: isRecord(entry.costPer1kTokens) && typeof entry.costPer1kTokens.input === 'number'
        ? entry.costPer1kTokens.input
        : 0,
      output: isRecord(entry.costPer1kTokens) && typeof entry.costPer1kTokens.output === 'number'
        ? entry.costPer1kTokens.output
        : 0,
    },
  };

  if (Array.isArray(entry.providers)) {
    sanitized.providers = entry.providers.filter((value): value is string => typeof value === 'string');
  }

  if (Array.isArray(entry.endpoints)) {
    const allowedEndpointNames = new Set([
      'responses',
      'realtime',
      'assistants',
      'batch',
      'fine-tuning',
      'embeddings',
      'image-generation',
      'videos',
      'image-edit',
      'speech-generation',
      'transcription',
      'translation',
      'moderation',
    ]);

    const endpoints = entry.endpoints
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        name: item.name,
        url: item.url,
      }))
      .filter((item): item is { name: string; url: string } => (
        typeof item.name === 'string'
        && typeof item.url === 'string'
        && allowedEndpointNames.has(item.name)
      ));

    if (endpoints.length > 0) {
      sanitized.endpoints = endpoints;
    }
  }

  if (typeof entry.maxContextTokens === 'number') {
    sanitized.maxContextTokens = entry.maxContextTokens;
  } else if (typeof entry.contextWindow === 'number') {
    sanitized.maxContextTokens = entry.contextWindow;
  }

  if (typeof entry.maxOutputTokens === 'number') {
    sanitized.maxOutputTokens = entry.maxOutputTokens;
  }

  if (typeof entry.contextWindow === 'number') {
    sanitized.contextWindow = entry.contextWindow;
  }

  if (typeof entry.reasoningTokenSupport === 'boolean') {
    sanitized.reasoningTokenSupport = entry.reasoningTokenSupport;
  }

  if (Array.isArray(entry.reasoningEfforts)) {
    sanitized.reasoningEfforts = entry.reasoningEfforts.filter((value): value is string => typeof value === 'string');
  } else if (Array.isArray(entry.resongingEfforts)) {
    sanitized.reasoningEfforts = entry.resongingEfforts.filter((value): value is string => typeof value === 'string');
  }

  if (Array.isArray(entry.capabilities)) {
    sanitized.capabilities = entry.capabilities.filter((value): value is string => typeof value === 'string');
  } else if (isRecord(entry.capabilities)) {
    sanitized.capabilities = {
      input: Array.isArray(entry.capabilities.input)
        ? entry.capabilities.input.filter((value): value is string => typeof value === 'string')
        : undefined,
      output: Array.isArray(entry.capabilities.output)
        ? entry.capabilities.output.filter((value): value is string => typeof value === 'string')
        : undefined,
    };
  }

  if (Array.isArray(entry.features)) {
    sanitized.features = entry.features.filter((value): value is string => typeof value === 'string');
  }

  if (Array.isArray(entry.tools)) {
    sanitized.tools = entry.tools.filter((value): value is string => typeof value === 'string');
  }

  return sanitized;
}

function loadModelsFromFacts(): Record<string, Record<string, Record<string, unknown>>> | undefined {
  const visited = new Set<string>();
  const candidates = getLlmFactsSourceCandidates();

  for (const candidate of candidates) {
    if (visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);

    if (!fs.existsSync(candidate)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      if (!isRecord(parsed)) {
        continue;
      }

      const grouped: Record<string, Record<string, Record<string, unknown>>> = {};
      for (const [providerId, providerModelsRaw] of Object.entries(parsed)) {
        if (!isRecord(providerModelsRaw)) {
          continue;
        }

        const providerModels: Record<string, Record<string, unknown>> = {};
        for (const [modelId, entry] of Object.entries(providerModelsRaw)) {
          const sanitized = sanitizeModelFact(modelId, entry);
          if (sanitized) {
            providerModels[modelId] = sanitized;
          }
        }

        if (Object.keys(providerModels).length > 0) {
          grouped[providerId] = providerModels;
        }
      }

      if (Object.keys(grouped).length > 0) {
        return grouped;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

/**
 * Template for llm-config.json
 */
const BASE_LLM_CONFIG_TEMPLATE = loadLlmConfigTemplateFromExample() ?? DEFAULT_LLM_CONFIG_TEMPLATE;
const FACTS_MODELS_TEMPLATE = loadModelsFromFacts();
const DISABLED_PROVIDERS_TEMPLATE = Object.fromEntries(
  Object.entries(BASE_LLM_CONFIG_TEMPLATE.providers).map(([providerId, providerConfig]) => [
    providerId,
    {
      ...providerConfig,
      enabled: false,
    },
  ])
);

export const LLM_CONFIG_TEMPLATE = FACTS_MODELS_TEMPLATE
  ? {
    ...BASE_LLM_CONFIG_TEMPLATE,
    providers: DISABLED_PROVIDERS_TEMPLATE,
    models: FACTS_MODELS_TEMPLATE,
  }
  : {
    ...BASE_LLM_CONFIG_TEMPLATE,
    providers: DISABLED_PROVIDERS_TEMPLATE,
  };

/**
 * Template for mcp-config.schema.json
 */
export const MCP_CONFIG_SCHEMA_TEMPLATE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/mcp-config.schema.json',
  title: 'PonyBunny MCP Configuration',
  description: 'Configuration for Model Context Protocol (MCP) server connections',
  type: 'object',
  properties: {
    $schema: { type: 'string', description: 'JSON Schema reference' },
    mcpServers: {
      type: 'object',
      description: 'Map of MCP server configurations',
      additionalProperties: { $ref: '#/$defs/MCPServerConfig' },
    },
  },
  additionalProperties: false,
  $defs: {
    MCPServerConfig: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Whether this MCP server is enabled',
          default: true,
        },
        transport: {
          type: 'string',
          enum: ['stdio', 'http'],
          description: 'Transport mechanism for MCP communication',
        },
        command: {
          type: 'string',
          description: "Command to execute for stdio transport (e.g., 'npx', 'node')",
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for the command (stdio transport)',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Environment variables for the MCP server process',
        },
        url: {
          type: 'string',
          format: 'uri',
          description: 'URL for HTTP transport',
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'HTTP headers for authentication (HTTP transport)',
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: "List of allowed tool names. Use '*' to allow all tools.",
          default: ['*'],
        },
        autoReconnect: {
          type: 'boolean',
          description: 'Automatically reconnect on connection loss',
          default: true,
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds for MCP operations',
          default: 30000,
          minimum: 1000,
          maximum: 300000,
        },
      },
      required: ['transport'],
      allOf: [
        {
          if: {
            properties: {
              transport: {
                const: 'stdio',
              },
            },
          },
          then: {
            required: ['command', 'args'],
          },
        },
        {
          if: {
            properties: {
              transport: {
                const: 'http',
              },
            },
          },
          then: {
            required: ['url'],
          },
        },
      ],
      additionalProperties: false,
    },
  },
};

/**
 * Template for mcp-config.json
 */
export const MCP_CONFIG_TEMPLATE = {
  $schema: 'https://ponybunny.dho.ai/schemas/mcp-config.schema.json',
  mcpServers: {
    filesystem: {
      enabled: false,
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/workspace'],
      allowedTools: ['read_file', 'write_file', 'list_directory', 'create_directory'],
      autoReconnect: true,
      timeout: 30000,
    },
    pg: {
      enabled: true,
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://pony:pony_pass@localhost:15432/ponybunny'],
      allowedTools: ['pg.select', 'pg.insert', 'pg.execute'],
      autoReconnect: true,
      timeout: 60000,
    },
    playwright: {
      enabled: true,
      transport: 'http' as const,
      url: 'http://localhost:17777/mcp',
      allowedTools: ['playwright.navigate', 'playwright.get_content', 'playwright.query_selector_all'],
      autoReconnect: true,
      timeout: 60000,
    },
  },
};

export const PONYBUNNY_CONFIG_SCHEMA_TEMPLATE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/ponybunny.schema.json',
  title: 'PonyBunny Runtime Configuration',
  type: 'object',
  required: ['paths', 'gateway', 'scheduler', 'agent', 'persona', 'debug', 'memory', 'tui'],
  properties: {
    $schema: { type: 'string' },
    paths: {
      type: 'object',
      required: ['database', 'schedulerSocket'],
      properties: {
        database: { type: 'string' },
        schedulerSocket: { type: 'string' },
      },
      additionalProperties: false,
    },
    gateway: {
      type: 'object',
      required: ['host', 'port'],
      properties: {
        host: { type: 'string' },
        port: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    scheduler: {
      type: 'object',
      required: [
        'tickIntervalMs',
        'maxConcurrentGoals',
        'agentsEnabled',
        'deterministicRuntimeEnabled',
        'planCompilerEnabled',
        'toolRoutingMode',
        'allowModelNativeTools',
        'runtimeRollout',
        'runEventRetention',
      ],
      properties: {
        tickIntervalMs: { type: 'integer', minimum: 1 },
        maxConcurrentGoals: { type: 'integer', minimum: 1 },
        agentsEnabled: { type: 'boolean' },
        deterministicRuntimeEnabled: { type: 'boolean' },
        planCompilerEnabled: { type: 'boolean' },
        toolRoutingMode: {
          type: 'string',
          enum: ['legacy', 'system_only', 'system_preferred', 'model_preferred'],
        },
        allowModelNativeTools: { type: 'boolean' },
        runtimeRollout: {
          type: 'object',
          required: ['shadowModeEnabled', 'canaryPercent', 'rollbackOnFailure', 'lanePercents'],
          properties: {
            shadowModeEnabled: { type: 'boolean' },
            canaryPercent: { type: 'integer', minimum: 0, maximum: 100 },
            rollbackOnFailure: { type: 'boolean' },
            lanePercents: {
              type: 'object',
              required: ['dryRun', 'compile', 'replay'],
              properties: {
                dryRun: { type: 'integer', minimum: 0, maximum: 100 },
                compile: { type: 'integer', minimum: 0, maximum: 100 },
                replay: { type: 'integer', minimum: 0, maximum: 100 },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        runEventRetention: {
          type: 'object',
          required: ['enabled', 'intervalMs', 'maxAgeMs', 'keepLatestPerRun'],
          properties: {
            enabled: { type: 'boolean' },
            intervalMs: { type: 'integer', minimum: 1 },
            maxAgeMs: { type: 'integer', minimum: 1 },
            keepLatestPerRun: { type: 'integer', minimum: 0, maximum: 10000 },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    agent: {
      type: 'object',
      required: ['mainAgentId', 'personaEnabled'],
      properties: {
        mainAgentId: { type: 'string', minLength: 1 },
        personaEnabled: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    persona: {
      type: 'object',
      required: ['directory', 'defaultPersonaId', 'promptOverrides'],
      properties: {
        directory: { type: 'string' },
        defaultPersonaId: { type: 'string', minLength: 1 },
        promptOverrides: {
          type: 'object',
          required: [
            'personalityDescription',
            'communicationStyleDescription',
            'expertiseDescription',
            'guidelines',
            'backstory',
          ],
          properties: {
            personalityDescription: { type: 'string' },
            communicationStyleDescription: { type: 'string' },
            expertiseDescription: { type: 'string' },
            guidelines: { type: 'string' },
            backstory: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    debug: {
      type: 'object',
      required: ['serverPort', 'loggingEnabled', 'antigravityDebug'],
      properties: {
        serverPort: { type: 'integer', minimum: 1 },
        loggingEnabled: { type: 'boolean' },
        antigravityDebug: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    memory: {
      type: 'object',
      required: [
        'backend',
        'database',
        'userProfileId',
        'autoSave',
        'embeddingProvider',
        'vectorWeight',
        'keywordWeight',
      ],
      properties: {
        backend: { type: 'string', enum: ['sqlite', 'memory'] },
        database: { type: 'string' },
        userProfileId: { type: 'string', minLength: 1 },
        autoSave: { type: 'boolean' },
        embeddingProvider: {
          type: 'string',
          pattern: '^(none|openai|custom:https?://.+)$',
        },
        vectorWeight: { type: 'number', minimum: 0, maximum: 1 },
        keywordWeight: { type: 'number', minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
    tui: {
      type: 'object',
      required: ['inputBackgroundColor', 'sessionFirstEnabled', 'goalSubmitFastPathEnabled'],
      properties: {
        inputBackgroundColor: {
          type: 'string',
          enum: ['gray', 'black', 'blue', 'green', 'yellow', 'magenta', 'cyan', 'white'],
        },
        sessionFirstEnabled: { type: 'boolean' },
        goalSubmitFastPathEnabled: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export function getPonyBunnyConfigTemplate() {
  const config = resolveRuntimeConfigFromEnvironment();
  return {
    ...config,
    persona: {
      ...config.persona,
      promptOverrides: {
        personalityDescription: 'Example: Warm, pragmatic, and outcomes-focused. Balance clarity with empathy.',
        communicationStyleDescription: 'Example: Start concise, then expand with concrete steps when user asks for depth.',
        expertiseDescription: 'Example: Strong in TypeScript, SQLite, CLI tooling, and production incident triage.',
        guidelines: 'Example: Prefer action over explanation, cite changed files, and surface tradeoffs explicitly.',
        backstory: 'Example: You are a senior software assistant embedded in the PonyBunny workflow.',
      },
    },
  };
}

const COMMON_RESOURCES_COMPOSE_TEMPLATE = `services:
  postgres:
    image: postgres:latest
    environment:
      POSTGRES_USER: pony
      POSTGRES_PASSWORD: pony_pass
      POSTGRES_DB: ponybunny
    ports:
      - "15432:5432"
    volumes:
      - "./data/postgres:/var/lib/postgresql"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pony -d ponybunny"]
      interval: 5s
      timeout: 5s
      retries: 10

  mcp-playwright:
    image: mcr.microsoft.com/playwright/mcp
    command:
      - --host
      - 0.0.0.0
      - --port
      - "17777"
    ports:
      - "17777:17777"
`;

/**
 * File info for onboarding
 */
export interface OnboardingFile {
  name: string;
  path: string;
  template: object | string;
  format: 'json' | 'raw';
  mode: number;
  description: string;
}

/**
 * Get all onboarding files
 */
export function getOnboardingFiles(): OnboardingFile[] {
  const configDir = getConfigDir();
  const installDir = getInstallDir();
  const promptDefaultsDir = getPromptDefaultsSourceDir();

  const promptTemplateFiles: OnboardingFile[] = getPromptSeedRelativePaths().map((relativePath) => ({
    name: path.join('prompts', relativePath),
    path: path.join(configDir, 'prompts', relativePath),
    template: readPromptDefaultTemplate(promptDefaultsDir, relativePath),
    format: 'raw',
    mode: relativePath === 'README.md' ? 0o644 : 0o600,
    description: `Prompt template: ${relativePath}`,
  }));

  const agentCustomizationFiles = getAgentCustomizationFiles(configDir);
  const skillSeedFiles = getSkillSeedFiles(configDir);

  return [
    {
      name: 'ponybunny.json',
      path: path.join(configDir, 'ponybunny.json'),
      template: getPonyBunnyConfigTemplate(),
      format: 'json',
      mode: 0o600,
      description: 'Runtime configuration (paths, gateway, scheduler, agent, persona, debug, memory)',
    },
    {
      name: 'credentials.json',
      path: path.join(configDir, 'credentials.json'),
      template: CREDENTIALS_TEMPLATE,
      format: 'json',
      mode: 0o600, // Restricted permissions for credentials
      description: 'API keys and endpoint credentials',
    },
    {
      name: 'llm-config.json',
      path: path.join(configDir, 'llm-config.json'),
      template: LLM_CONFIG_TEMPLATE,
      format: 'json',
      mode: 0o644,
    description: 'LLM providers, models, tiers, and workload configuration',
    },
    {
      name: 'mcp-config.json',
      path: path.join(configDir, 'mcp-config.json'),
      template: MCP_CONFIG_TEMPLATE,
      format: 'json',
      mode: 0o600,
      description: 'MCP server configuration',
    },
    {
      name: 'resources/docker-compose.common.yml',
      path: path.join(installDir, 'resources', 'docker-compose.common.yml'),
      template: COMMON_RESOURCES_COMPOSE_TEMPLATE,
      format: 'raw',
      mode: 0o644,
      description: 'Common services (Postgres + Playwright MCP)',
    },
    ...agentCustomizationFiles,
    ...skillSeedFiles,
    ...promptTemplateFiles,
  ];
}

function getSkillSeedFiles(configDir: string): OnboardingFile[] {
  const sourceRoot = path.join(process.cwd(), 'skills');
  if (!fs.existsSync(sourceRoot)) {
    return [];
  }

  const files = collectRegularFiles(sourceRoot);
  return files.map((sourcePath) => {
    const relativePath = path.relative(sourceRoot, sourcePath);
    const targetPath = path.join(configDir, 'skills', relativePath);
    return {
      name: path.join('skills', relativePath),
      path: targetPath,
      template: fs.readFileSync(sourcePath, 'utf-8'),
      format: 'raw' as const,
      mode: 0o600,
      description: `User-customizable skill seed: ${relativePath}`,
    };
  });
}

function collectRegularFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop()!;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  results.sort((left, right) => left.localeCompare(right));
  return results;
}

function getAgentCustomizationFiles(configDir: string): OnboardingFile[] {
  const agentsRoot = path.join(process.cwd(), 'agents');
  if (!fs.existsSync(agentsRoot)) {
    return [];
  }

  const agentIds = fs
    .readdirSync(agentsRoot)
    .filter((entry) => {
      const sourceDir = path.join(agentsRoot, entry);
      if (!fs.statSync(sourceDir).isDirectory()) {
        return false;
      }
      return (
        fs.existsSync(path.join(sourceDir, 'agent.json'))
        && fs.existsSync(path.join(sourceDir, 'AGENT.md'))
      );
    })
    .sort((a, b) => a.localeCompare(b));

  const files: OnboardingFile[] = [];
  for (const agentId of agentIds) {
    const sourceDir = path.join(agentsRoot, agentId);
    const sourceJson = path.join(sourceDir, 'agent.json');
    const sourceMarkdown = path.join(sourceDir, 'AGENT.md');

    files.push(
      {
        name: path.join('agents', agentId, 'agent.json'),
        path: path.join(configDir, 'agents', agentId, 'agent.json'),
        template: fs.readFileSync(sourceJson, 'utf-8'),
        format: 'raw',
        mode: 0o600,
        description: `User-customizable agent config seed for '${agentId}'`,
      },
      {
        name: path.join('agents', agentId, 'AGENT.md'),
        path: path.join(configDir, 'agents', agentId, 'AGENT.md'),
        template: fs.readFileSync(sourceMarkdown, 'utf-8'),
        format: 'raw',
        mode: 0o600,
        description: `User-customizable agent prompt seed for '${agentId}'`,
      }
    );
  }

  return files;
}

function getPromptDefaultsSourceDir(): string {
  const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
  const entryDir = entryPoint ? path.dirname(entryPoint) : undefined;

  const entryCandidates = entryDir
    ? [
      path.join(entryDir, '..', 'prompts', 'defaults'),
      path.join(entryDir, 'infra', 'prompts', 'defaults'),
      path.join(entryDir, '..', 'infra', 'prompts', 'defaults'),
    ]
    : [];

  const envCandidate = process.env.PONYBUNNY_PROMPT_DEFAULTS_DIR;
  const candidates = [
    ...(envCandidate ? [envCandidate] : []),
    path.join(process.cwd(), 'src', 'infra', 'prompts', 'defaults'),
    path.join(process.cwd(), 'dist', 'infra', 'prompts', 'defaults'),
    ...entryCandidates,
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function readPromptDefaultTemplate(baseDir: string, relativePath: string): string {
  const filePath = path.join(baseDir, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Default prompt template missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Result of initializing a single file
 */
export interface InitFileResult {
  file: string;
  status: 'created' | 'updated' | 'exists' | 'error';
  message: string;
}

/**
 * Options for initialization
 */
export interface InitOptions {
  /** Overwrite existing files */
  force?: boolean;
  /** Only check what would be created, don't actually create */
  dryRun?: boolean;
}

/**
 * Initialize a single config file
 */
export function initConfigFile(file: OnboardingFile, options: InitOptions = {}): InitFileResult {
  const { force = false, dryRun = false } = options;

  try {
    const exists = fs.existsSync(file.path);

    if (exists && !force) {
      return {
        file: file.name,
        status: 'exists',
        message: `Already exists at ${file.path}`,
      };
    }

    if (dryRun) {
      return {
        file: file.name,
        status: 'created',
        message: `Would create at ${file.path}`,
      };
    }

    // Ensure directory exists
    const dir = path.dirname(file.path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Write file
    const payload =
      file.format === 'raw' ? String(file.template) : JSON.stringify(file.template, null, 2);
    fs.writeFileSync(file.path, payload, { mode: file.mode });

    return {
      file: file.name,
      status: 'created',
      message: `Created at ${file.path}`,
    };
  } catch (error) {
    return {
      file: file.name,
      status: 'error',
      message: `Failed: ${(error as Error).message}`,
    };
  }
}

function mergeCommonMCPServers(config: Record<string, unknown>): boolean {
  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const commonServers = (MCP_CONFIG_TEMPLATE as { mcpServers: Record<string, unknown> }).mcpServers;

  let changed = false;
  for (const [serverName, serverConfig] of Object.entries(commonServers)) {
    if (!(serverName in mcpServers)) {
      mcpServers[serverName] = serverConfig;
      changed = true;
    }
  }

  if (changed) {
    config.mcpServers = mcpServers;
  }

  return changed;
}

function ensureCommonMCPConfig(options: InitOptions = {}): InitFileResult {
  const configPath = path.join(getConfigDir(), 'mcp-config.json');

  try {
    if (!fs.existsSync(configPath)) {
      return initConfigFile(
        {
          name: 'mcp-config.json',
          path: configPath,
          template: MCP_CONFIG_TEMPLATE,
          format: 'json',
          mode: 0o600,
          description: 'MCP server configuration',
        },
        options
      );
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const changed = mergeCommonMCPServers(parsed);

    if (!changed) {
      return {
        file: 'mcp-config.json',
        status: 'exists',
        message: `Already includes common MCP servers at ${configPath}`,
      };
    }

    if (options.dryRun) {
      return {
        file: 'mcp-config.json',
        status: 'updated',
        message: `Would merge common MCP servers into ${configPath}`,
      };
    }

    fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    return {
      file: 'mcp-config.json',
      status: 'updated',
      message: `Merged common MCP servers into ${configPath}`,
    };
  } catch (error) {
    return {
      file: 'mcp-config.json',
      status: 'error',
      message: `Failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Initialize all config files
 */
export function initAllConfigFiles(options: InitOptions = {}): InitFileResult[] {
  const files = getOnboardingFiles();
  const results = files.map((file) => initConfigFile(file, options));

  const mcpIndex = results.findIndex((result) => result.file === 'mcp-config.json');
  if (mcpIndex !== -1 && results[mcpIndex].status === 'exists') {
    results[mcpIndex] = ensureCommonMCPConfig(options);
  }

  return results;
}

/**
 * Check which config files are missing
 */
export function checkMissingConfigFiles(): OnboardingFile[] {
  const files = getOnboardingFiles();
  return files.filter((file) => !fs.existsSync(file.path));
}

/**
 * Check if onboarding is needed (any config file missing)
 */
export function isOnboardingNeeded(): boolean {
  return checkMissingConfigFiles().length > 0;
}
