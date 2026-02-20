import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getPromptSeedRelativePaths } from '../prompts/template-loader.js';
import { getConfigDir as getGlobalConfigDir, getInstallDir } from './config-paths.js';

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
  $schema: './mcp-config.schema.json',
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

  return [
    {
      name: 'credentials.schema.json',
      path: path.join(configDir, 'credentials.schema.json'),
      template: CREDENTIALS_SCHEMA_TEMPLATE,
      format: 'json',
      mode: 0o644,
      description: 'JSON Schema for credentials validation',
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
      name: 'llm-config.schema.json',
      path: path.join(configDir, 'llm-config.schema.json'),
      template: LLM_CONFIG_SCHEMA_TEMPLATE,
      format: 'json',
      mode: 0o644,
      description: 'JSON Schema for LLM configuration validation',
    },
    {
      name: 'llm-config.json',
      path: path.join(configDir, 'llm-config.json'),
      template: LLM_CONFIG_TEMPLATE,
      format: 'json',
      mode: 0o644,
      description: 'LLM endpoints, models, tiers, and agent configuration',
    },
    {
      name: 'mcp-config.schema.json',
      path: path.join(configDir, 'mcp-config.schema.json'),
      template: MCP_CONFIG_SCHEMA_TEMPLATE,
      format: 'json',
      mode: 0o644,
      description: 'JSON Schema for MCP configuration validation',
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
    ...promptTemplateFiles,
  ];
}

function getPromptDefaultsSourceDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, '..', 'prompts', 'defaults'),
    path.join(process.cwd(), 'src', 'infra', 'prompts', 'defaults'),
    path.join(process.cwd(), 'dist', 'infra', 'prompts', 'defaults'),
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
