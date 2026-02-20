/**
 * MCP Configuration Loader
 * Loads and validates MCP server configurations from ~/.config/ponybunny/mcp-config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { getConfigDir } from '../../config/credentials-loader.js';
import type { MCPConfig, MCPServerConfig } from '../client/types.js';
import { MCPConfigError } from '../client/types.js';

/**
 * Get the MCP config file path
 */
export function getMCPConfigPath(): string {
  return path.join(getConfigDir(), 'mcp-config.json');
}

/**
 * Get the MCP config schema file path
 */
export function getMCPConfigSchemaPath(): string {
  return path.join(getConfigDir(), 'mcp-config.schema.json');
}

/**
 * Embedded schema for validation (used when schema file is missing)
 */
const EMBEDDED_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/mcp-config.schema.json',
  title: 'PonyBunny MCP Configuration',
  description: 'Configuration for Model Context Protocol (MCP) server connections',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    mcpServers: {
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/MCPServerConfig',
      },
    },
  },
  additionalProperties: false,
  $defs: {
    MCPServerConfig: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', default: true },
        transport: { type: 'string', enum: ['stdio', 'http'] },
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        env: { type: 'object', additionalProperties: { type: 'string' } },
        url: { type: 'string', format: 'uri' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        allowedTools: { type: 'array', items: { type: 'string' }, default: ['*'] },
        autoReconnect: { type: 'boolean', default: true },
        timeout: { type: 'number', default: 30000, minimum: 1000, maximum: 300000 },
      },
      required: ['transport'],
      additionalProperties: false,
    },
  },
};

/**
 * Create AJV validator instance
 */
function createValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/**
 * Load schema from file or use embedded
 */
function loadSchema(): object {
  const schemaPath = getMCPConfigSchemaPath();

  try {
    if (fs.existsSync(schemaPath)) {
      const content = fs.readFileSync(schemaPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(`[MCPConfigLoader] Failed to load schema file, using embedded: ${(error as Error).message}`);
  }

  return EMBEDDED_SCHEMA;
}

/**
 * Validate MCP config against JSON Schema
 */
export function validateMCPConfig(config: unknown): MCPConfig {
  const ajv = createValidator();
  const schema = loadSchema();
  const validate = ajv.compile(schema);

  if (!validate(config)) {
    const errors = (validate.errors || []).map((err) => ({
      path: err.instancePath || '/',
      message: err.message || 'Unknown validation error',
    }));

    throw new MCPConfigError(
      `Invalid MCP configuration: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`
    );
  }

  return config as MCPConfig;
}

/**
 * Expand environment variables in string values
 * Supports ${VAR_NAME} syntax
 */
function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || '';
  });
}

/**
 * Expand environment variables in server config
 */
function expandServerConfigEnvVars(config: MCPServerConfig): MCPServerConfig {
  const expanded = { ...config };

  // Expand env variables
  if (expanded.env) {
    expanded.env = Object.fromEntries(
      Object.entries(expanded.env).map(([key, value]) => [key, expandEnvVars(value)])
    );
  }

  // Expand headers
  if (expanded.headers) {
    expanded.headers = Object.fromEntries(
      Object.entries(expanded.headers).map(([key, value]) => [key, expandEnvVars(value)])
    );
  }

  // Expand URL
  if (expanded.url) {
    expanded.url = expandEnvVars(expanded.url);
  }

  return expanded;
}

/**
 * Load MCP config from ~/.config/ponybunny/mcp-config.json
 * Returns null if file doesn't exist
 * Throws MCPConfigError if file is invalid
 */
export function loadMCPConfig(): MCPConfig | null {
  const configPath = getMCPConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate against schema
    const validated = validateMCPConfig(parsed);

    // Expand environment variables in all server configs
    if (validated.mcpServers) {
      validated.mcpServers = Object.fromEntries(
        Object.entries(validated.mcpServers).map(([name, config]) => [
          name,
          expandServerConfigEnvVars(config),
        ])
      );
    }

    return validated;
  } catch (error) {
    if (error instanceof MCPConfigError) {
      throw error;
    }
    console.warn(`[MCPConfigLoader] Failed to load MCP config: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Get config for a specific MCP server
 */
export function getMCPServerConfig(serverName: string): MCPServerConfig | null {
  const config = loadMCPConfig();
  if (!config?.mcpServers) {
    return null;
  }

  return config.mcpServers[serverName] || null;
}

/**
 * Save MCP config to ~/.config/ponybunny/mcp-config.json
 * Creates the directory if it doesn't exist
 * Validates config before saving
 */
export function saveMCPConfig(config: MCPConfig): void {
  // Validate before saving
  validateMCPConfig(config);

  const configDir = getConfigDir();
  const configPath = getMCPConfigPath();

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  // Add schema reference
  const configWithSchema = {
    $schema: './mcp-config.schema.json',
    ...config,
  };

  // Write with restricted permissions
  fs.writeFileSync(configPath, JSON.stringify(configWithSchema, null, 2), {
    mode: 0o600,
  });
}

/**
 * Add or update an MCP server configuration
 */
export function setMCPServerConfig(serverName: string, serverConfig: MCPServerConfig): void {
  const config = loadMCPConfig() || { mcpServers: {} };

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers[serverName] = serverConfig;
  saveMCPConfig(config);
}

/**
 * Remove an MCP server configuration
 */
export function removeMCPServerConfig(serverName: string): boolean {
  const config = loadMCPConfig();
  if (!config?.mcpServers || !config.mcpServers[serverName]) {
    return false;
  }

  delete config.mcpServers[serverName];
  saveMCPConfig(config);
  return true;
}

/**
 * List all configured MCP server names
 */
export function listMCPServers(): string[] {
  const config = loadMCPConfig();
  if (!config?.mcpServers) {
    return [];
  }

  return Object.keys(config.mcpServers);
}

/**
 * List enabled MCP server names
 */
export function listEnabledMCPServers(): string[] {
  const config = loadMCPConfig();
  if (!config?.mcpServers) {
    return [];
  }

  return Object.entries(config.mcpServers)
    .filter(([_, serverConfig]) => serverConfig.enabled !== false)
    .map(([name]) => name);
}

/**
 * Check if MCP config file exists
 */
export function mcpConfigFileExists(): boolean {
  return fs.existsSync(getMCPConfigPath());
}

// Cache for MCP config to avoid repeated file reads
let mcpConfigCache: MCPConfig | null | undefined = undefined;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000; // 5 seconds

/**
 * Get MCP config with caching (for performance in hot paths)
 */
export function getCachedMCPConfig(): MCPConfig | null {
  const now = Date.now();

  if (mcpConfigCache === undefined || now - cacheTimestamp > CACHE_TTL_MS) {
    mcpConfigCache = loadMCPConfig();
    cacheTimestamp = now;
  }

  return mcpConfigCache;
}

/**
 * Clear the MCP config cache (useful after updates)
 */
export function clearMCPConfigCache(): void {
  mcpConfigCache = undefined;
  cacheTimestamp = 0;
}
