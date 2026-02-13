import type { ProtocolId } from '../protocols/index.js';
import { getCachedEndpointCredential } from '../../config/credentials-loader.js';
import { authManagerV2 } from '../../../cli/lib/auth-manager-v2.js';

/**
 * Supported endpoint identifiers
 */
export type EndpointId =
  | 'anthropic-direct'
  | 'aws-bedrock'
  | 'openai-direct'
  | 'azure-openai'
  | 'openai-compatible'
  | 'google-ai-studio'
  | 'google-vertex-ai'
  | 'codex';

/**
 * Endpoint configuration
 */
export interface EndpointConfig {
  /** Unique endpoint identifier */
  id: EndpointId;
  /** Protocol used by this endpoint */
  protocol: ProtocolId;
  /** Base URL for API requests */
  baseUrl: string;
  /** Environment variables required for this endpoint */
  requiredEnvVars: string[];
  /** Optional environment variables */
  optionalEnvVars?: string[];
  /** Priority for endpoint selection (lower = preferred) */
  priority: number;
  /** Cost multiplier relative to direct API (1.0 = same cost) */
  costMultiplier?: number;
  /** Human-readable name */
  displayName: string;
  /** Description of the endpoint */
  description?: string;
}

/**
 * Runtime endpoint credentials resolved from environment
 */
export interface ResolvedEndpointCredentials {
  endpointId: EndpointId;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  projectId?: string;
  endpoint?: string;
  /** Override base URL from credentials file */
  baseUrl?: string;
  accessToken?: string;
}

/**
 * Map environment variable names to credential fields
 */
const ENV_TO_CREDENTIAL_FIELD: Record<string, keyof ResolvedEndpointCredentials> = {
  'ANTHROPIC_API_KEY': 'apiKey',
  'OPENAI_API_KEY': 'apiKey',
  'GEMINI_API_KEY': 'apiKey',
  'AZURE_OPENAI_API_KEY': 'apiKey',
  'OPENAI_COMPATIBLE_API_KEY': 'apiKey',
  'OPENAI_COMPATIBLE_BASE_URL': 'baseUrl',
  'AWS_ACCESS_KEY_ID': 'accessKeyId',
  'AWS_SECRET_ACCESS_KEY': 'secretAccessKey',
  'AWS_REGION': 'region',
  'AZURE_OPENAI_ENDPOINT': 'endpoint',
  'GOOGLE_CLOUD_PROJECT': 'projectId',
  'GOOGLE_CLOUD_REGION': 'region',
};

/**
 * Map credential file fields to ResolvedEndpointCredentials fields
 */
const CREDENTIAL_FILE_MAPPING: Record<string, keyof ResolvedEndpointCredentials> = {
  'apiKey': 'apiKey',
  'accessKeyId': 'accessKeyId',
  'secretAccessKey': 'secretAccessKey',
  'region': 'region',
  'endpoint': 'endpoint',
  'projectId': 'projectId',
  'baseUrl': 'baseUrl',
};

/**
 * Get credential value with priority: env var > credentials file
 */
function getCredentialValue(
  _endpointId: EndpointId,
  envVar: string,
  fileCredential: ReturnType<typeof getCachedEndpointCredential>
): string | undefined {
  // Priority 1: Environment variable
  const envValue = process.env[envVar];
  if (envValue) {
    return envValue;
  }

  // Priority 2: Credentials file
  if (fileCredential) {
    const field = ENV_TO_CREDENTIAL_FIELD[envVar];
    if (field && field !== 'endpointId') {
      const fileField = Object.entries(CREDENTIAL_FILE_MAPPING).find(([_, v]) => v === field)?.[0];
      if (fileField && fileField in fileCredential) {
        return (fileCredential as Record<string, string | undefined>)[fileField];
      }
    }
  }

  return undefined;
}

/**
 * Check if an endpoint has all required credentials configured
 * Checks both environment variables and ~/.ponybunny/credentials.json
 */
export function hasRequiredCredentials(config: EndpointConfig): boolean {
  const fileCredential = getCachedEndpointCredential(config.id);

  // Check if explicitly disabled in credentials file
  if (fileCredential?.enabled === false) {
    return false;
  }

  if (config.protocol === 'codex') {
    return authManagerV2.isAuthenticated();
  }

  return config.requiredEnvVars.every(envVar => {
    // Check env var first
    if (process.env[envVar]) {
      return true;
    }

    // Check credentials file
    if (fileCredential) {
      const field = ENV_TO_CREDENTIAL_FIELD[envVar];
      if (field && field !== 'endpointId') {
        const fileField = Object.entries(CREDENTIAL_FILE_MAPPING).find(([_, v]) => v === field)?.[0];
        if (fileField && fileField in fileCredential) {
          return !!(fileCredential as Record<string, string | undefined>)[fileField];
        }
      }
    }

    return false;
  });
}

/**
 * Resolve credentials for an endpoint
 * Priority: environment variables > ~/.ponybunny/credentials.json
 */
export function resolveCredentials(config: EndpointConfig): ResolvedEndpointCredentials | null {
  if (!hasRequiredCredentials(config)) {
    return null;
  }

  const fileCredential = getCachedEndpointCredential(config.id);
  const credentials: ResolvedEndpointCredentials = {
    endpointId: config.id,
  };

  // Resolve all environment variables (required + optional)
  const allEnvVars = [...config.requiredEnvVars, ...(config.optionalEnvVars || [])];
  for (const envVar of allEnvVars) {
    const value = getCredentialValue(config.id, envVar, fileCredential);
    if (value) {
      const field = ENV_TO_CREDENTIAL_FIELD[envVar];
      if (field && field !== 'endpointId') {
        credentials[field] = value;
      }
    }
  }

  // Check for baseUrl override in credentials file
  if (fileCredential?.baseUrl) {
    credentials.baseUrl = fileCredential.baseUrl;
  }

  return credentials;
}
