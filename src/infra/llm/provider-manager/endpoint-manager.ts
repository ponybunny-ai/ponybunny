import type { LLMEndpointConfig } from './types.js';
import { getCachedConfig } from './config-loader.js';
import { getCachedEndpointCredential } from '../../config/credentials-loader.js';

/**
 * Endpoint health status
 */
export interface EndpointHealth {
  endpointId: string;
  available: boolean;
  hasCredentials: boolean;
  enabled: boolean;
  lastChecked: number;
  lastError?: string;
}

/**
 * Map endpoint IDs to their required credential fields
 */
const ENDPOINT_CREDENTIAL_REQUIREMENTS: Record<string, string[]> = {
  'anthropic-direct': ['apiKey'],
  'aws-bedrock': ['accessKeyId', 'secretAccessKey'],
  'openai-direct': ['apiKey'],
  'azure-openai': ['apiKey', 'endpoint'],
  'google-ai-studio': ['apiKey'],
  'google-vertex-ai': ['projectId'],
};

/**
 * Map endpoint IDs to environment variable names
 */
const ENDPOINT_ENV_VARS: Record<string, string[]> = {
  'anthropic-direct': ['ANTHROPIC_API_KEY'],
  'aws-bedrock': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  'openai-direct': ['OPENAI_API_KEY'],
  'azure-openai': ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'],
  'google-ai-studio': ['GEMINI_API_KEY'],
  'google-vertex-ai': ['GOOGLE_CLOUD_PROJECT'],
};

/**
 * Endpoint Manager
 * Manages endpoint availability, health checking, and credential resolution
 */
export class EndpointManager {
  private healthCache = new Map<string, EndpointHealth>();
  private healthCacheTTL: number;

  constructor(options: { healthCacheTTL?: number } = {}) {
    this.healthCacheTTL = options.healthCacheTTL || 30000; // 30 seconds default
  }

  /**
   * Get all enabled endpoints from configuration
   */
  getEnabledEndpoints(): Array<{ id: string; config: LLMEndpointConfig }> {
    const config = getCachedConfig();
    return Object.entries(config.endpoints)
      .filter(([_, endpointConfig]) => endpointConfig.enabled)
      .map(([id, endpointConfig]) => ({ id, config: endpointConfig }))
      .sort((a, b) => a.config.priority - b.config.priority);
  }

  /**
   * Get endpoint configuration by ID
   */
  getEndpointConfig(endpointId: string): LLMEndpointConfig | undefined {
    const config = getCachedConfig();
    return config.endpoints[endpointId];
  }

  /**
   * Check if an endpoint has required credentials
   */
  hasCredentials(endpointId: string): boolean {
    // Check credentials file first
    const fileCredential = getCachedEndpointCredential(endpointId);
    if (fileCredential?.enabled === false) {
      return false;
    }

    const requiredFields = ENDPOINT_CREDENTIAL_REQUIREMENTS[endpointId] || ['apiKey'];
    const envVars = ENDPOINT_ENV_VARS[endpointId] || [];

    // Check if credentials file has required fields
    if (fileCredential) {
      const hasAllFields = requiredFields.every(field => {
        const value = (fileCredential as Record<string, unknown>)[field];
        return value !== undefined && value !== null && value !== '';
      });
      if (hasAllFields) {
        return true;
      }
    }

    // Check environment variables
    const hasAllEnvVars = envVars.every(envVar => {
      const value = process.env[envVar];
      return value !== undefined && value !== '';
    });

    return hasAllEnvVars;
  }

  /**
   * Check if an endpoint is available (enabled + has credentials)
   */
  async isEndpointAvailable(endpointId: string): Promise<boolean> {
    const health = await this.getEndpointHealth(endpointId);
    return health.available;
  }

  /**
   * Get endpoint health status
   */
  async getEndpointHealth(endpointId: string): Promise<EndpointHealth> {
    // Check cache first
    const cached = this.healthCache.get(endpointId);
    const now = Date.now();

    if (cached && now - cached.lastChecked < this.healthCacheTTL) {
      return cached;
    }

    // Build health status
    const config = this.getEndpointConfig(endpointId);
    const enabled = config?.enabled ?? false;
    const hasCredentials = this.hasCredentials(endpointId);

    const health: EndpointHealth = {
      endpointId,
      available: enabled && hasCredentials,
      hasCredentials,
      enabled,
      lastChecked: now,
    };

    if (!enabled) {
      health.lastError = 'Endpoint is disabled in configuration';
    } else if (!hasCredentials) {
      health.lastError = 'Missing required credentials';
    }

    this.healthCache.set(endpointId, health);
    return health;
  }

  /**
   * Get all endpoint health statuses
   */
  async getAllEndpointHealth(): Promise<EndpointHealth[]> {
    const config = getCachedConfig();
    const endpointIds = Object.keys(config.endpoints);

    return Promise.all(endpointIds.map(id => this.getEndpointHealth(id)));
  }

  /**
   * Get available endpoints for a model
   */
  async getAvailableEndpointsForModel(modelId: string): Promise<string[]> {
    const config = getCachedConfig();
    const modelConfig = config.models[modelId];

    if (!modelConfig) {
      return [];
    }

    const availableEndpoints: string[] = [];

    for (const endpointId of modelConfig.endpoints) {
      const isAvailable = await this.isEndpointAvailable(endpointId);
      if (isAvailable) {
        availableEndpoints.push(endpointId);
      }
    }

    // Sort by priority
    return availableEndpoints.sort((a, b) => {
      const configA = config.endpoints[a];
      const configB = config.endpoints[b];
      return (configA?.priority || 999) - (configB?.priority || 999);
    });
  }

  /**
   * Get the preferred endpoint for a model
   */
  async getPreferredEndpointForModel(modelId: string): Promise<string | undefined> {
    const available = await this.getAvailableEndpointsForModel(modelId);
    return available[0];
  }

  /**
   * Mark an endpoint as failed (temporarily unavailable)
   */
  markEndpointFailed(endpointId: string, error: string): void {
    const health: EndpointHealth = {
      endpointId,
      available: false,
      hasCredentials: this.hasCredentials(endpointId),
      enabled: this.getEndpointConfig(endpointId)?.enabled ?? false,
      lastChecked: Date.now(),
      lastError: error,
    };

    this.healthCache.set(endpointId, health);
  }

  /**
   * Clear health cache for an endpoint or all endpoints
   */
  clearHealthCache(endpointId?: string): void {
    if (endpointId) {
      this.healthCache.delete(endpointId);
    } else {
      this.healthCache.clear();
    }
  }

  /**
   * Resolve credentials for an endpoint
   * Priority: environment variables > credentials file
   */
  resolveCredentials(endpointId: string): Record<string, string> | null {
    if (!this.hasCredentials(endpointId)) {
      return null;
    }

    const fileCredential = getCachedEndpointCredential(endpointId);
    const envVars = ENDPOINT_ENV_VARS[endpointId] || [];
    const credentials: Record<string, string> = {};

    // Map env var names to credential field names
    const envVarToField: Record<string, string> = {
      'ANTHROPIC_API_KEY': 'apiKey',
      'OPENAI_API_KEY': 'apiKey',
      'GEMINI_API_KEY': 'apiKey',
      'AZURE_OPENAI_API_KEY': 'apiKey',
      'AWS_ACCESS_KEY_ID': 'accessKeyId',
      'AWS_SECRET_ACCESS_KEY': 'secretAccessKey',
      'AWS_REGION': 'region',
      'AZURE_OPENAI_ENDPOINT': 'endpoint',
      'GOOGLE_CLOUD_PROJECT': 'projectId',
      'GOOGLE_CLOUD_REGION': 'region',
    };

    // First, load from credentials file
    if (fileCredential) {
      const fields = ['apiKey', 'accessKeyId', 'secretAccessKey', 'region', 'endpoint', 'projectId', 'baseUrl'];
      for (const field of fields) {
        const value = (fileCredential as Record<string, unknown>)[field];
        if (value !== undefined && value !== null && value !== '') {
          credentials[field] = String(value);
        }
      }
    }

    // Then, override with environment variables (higher priority)
    for (const envVar of envVars) {
      const value = process.env[envVar];
      if (value) {
        const field = envVarToField[envVar];
        if (field) {
          credentials[field] = value;
        }
      }
    }

    // Also check optional env vars
    const optionalEnvVars = ['AWS_REGION', 'GOOGLE_CLOUD_REGION'];
    for (const envVar of optionalEnvVars) {
      const value = process.env[envVar];
      if (value) {
        const field = envVarToField[envVar];
        if (field) {
          credentials[field] = value;
        }
      }
    }

    return Object.keys(credentials).length > 0 ? credentials : null;
  }
}

// Singleton instance
let instance: EndpointManager | null = null;

/**
 * Get the singleton EndpointManager instance
 */
export function getEndpointManager(): EndpointManager {
  if (!instance) {
    instance = new EndpointManager();
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetEndpointManager(): void {
  instance = null;
}
