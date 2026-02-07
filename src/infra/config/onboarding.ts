import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get the PonyBunny config directory path
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.ponybunny');
}

/**
 * Template for credentials.schema.json
 */
export const CREDENTIALS_SCHEMA_TEMPLATE = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/credentials.schema.json',
  title: 'PonyBunny Credentials',
  description: 'Credentials configuration for LLM endpoints',
  type: 'object',
  properties: {
    $schema: { type: 'string', description: 'JSON Schema reference' },
    endpoints: {
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
        enabled: {
          type: 'boolean',
          description: 'Whether this endpoint is enabled (default: true if credentials are present)',
        },
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
  $schema: './credentials.schema.json',
  endpoints: {
    'anthropic-direct': {
      enabled: false,
      apiKey: '',
      baseUrl: '',
    },
    'aws-bedrock': {
      enabled: false,
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
      baseUrl: '',
    },
    'openai-direct': {
      enabled: false,
      apiKey: '',
      baseUrl: '',
    },
    'azure-openai': {
      enabled: false,
      apiKey: '',
      endpoint: '',
      baseUrl: '',
    },
    'google-ai-studio': {
      enabled: false,
      apiKey: '',
      baseUrl: '',
    },
    'google-vertex-ai': {
      enabled: false,
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
          protocol: { type: 'string', enum: ['anthropic', 'openai', 'gemini'] },
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
 * Template for llm-config.json
 */
export const LLM_CONFIG_TEMPLATE = {
  $schema: './llm-config.schema.json',

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
 * File info for onboarding
 */
export interface OnboardingFile {
  name: string;
  path: string;
  template: object;
  mode: number;
  description: string;
}

/**
 * Get all onboarding files
 */
export function getOnboardingFiles(): OnboardingFile[] {
  const configDir = getConfigDir();

  return [
    {
      name: 'credentials.schema.json',
      path: path.join(configDir, 'credentials.schema.json'),
      template: CREDENTIALS_SCHEMA_TEMPLATE,
      mode: 0o644,
      description: 'JSON Schema for credentials validation',
    },
    {
      name: 'credentials.json',
      path: path.join(configDir, 'credentials.json'),
      template: CREDENTIALS_TEMPLATE,
      mode: 0o600, // Restricted permissions for credentials
      description: 'API keys and endpoint credentials',
    },
    {
      name: 'llm-config.schema.json',
      path: path.join(configDir, 'llm-config.schema.json'),
      template: LLM_CONFIG_SCHEMA_TEMPLATE,
      mode: 0o644,
      description: 'JSON Schema for LLM configuration validation',
    },
    {
      name: 'llm-config.json',
      path: path.join(configDir, 'llm-config.json'),
      template: LLM_CONFIG_TEMPLATE,
      mode: 0o644,
      description: 'LLM endpoints, models, tiers, and agent configuration',
    },
  ];
}

/**
 * Result of initializing a single file
 */
export interface InitFileResult {
  file: string;
  status: 'created' | 'exists' | 'error';
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
    fs.writeFileSync(file.path, JSON.stringify(file.template, null, 2), {
      mode: file.mode,
    });

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

/**
 * Initialize all config files
 */
export function initAllConfigFiles(options: InitOptions = {}): InitFileResult[] {
  const files = getOnboardingFiles();
  return files.map((file) => initConfigFile(file, options));
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
