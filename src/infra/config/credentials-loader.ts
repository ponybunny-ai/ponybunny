import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { getConfigDir } from './config-paths.js';

export { getConfigDir } from './config-paths.js';

/**
 * Credentials validation error
 */
export class CredentialsValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: Array<{ path: string; message: string }>
  ) {
    super(message);
    this.name = 'CredentialsValidationError';
  }
}

/**
 * Credentials for a specific endpoint
 */
export interface EndpointCredential {
  /** Whether this endpoint is enabled (default: true if credentials are present) */
  enabled?: boolean;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  endpoint?: string;
  projectId?: string;
  /** Override the default base URL for this endpoint */
  baseUrl?: string;
}

/**
 * Structure of ~/.config/ponybunny/credentials.json
 */
export interface CredentialsFile {
  endpoints?: Record<string, EndpointCredential>;
}

/**
 * Get the credentials file path
 */
export function getCredentialsPath(): string {
  return path.join(getConfigDir(), 'credentials.json');
}

/**
 * Get the credentials schema file path
 */
export function getCredentialsSchemaPath(): string {
  return path.join(getConfigDir(), 'credentials.schema.json');
}

/**
 * Embedded schema for validation (used when schema file is missing)
 */
const EMBEDDED_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ponybunny.dev/schemas/credentials.schema.json',
  title: 'PonyBunny Credentials',
  description: 'Credentials configuration for LLM endpoints',
  type: 'object',
  properties: {
    $schema: { type: 'string' },
    endpoints: {
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/EndpointCredential',
      },
    },
  },
  additionalProperties: false,
  $defs: {
    EndpointCredential: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        apiKey: { type: 'string' },
        accessKeyId: { type: 'string' },
        secretAccessKey: { type: 'string' },
        region: { type: 'string' },
        endpoint: { type: 'string' },
        projectId: { type: 'string' },
        baseUrl: { type: 'string' },
      },
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
  const schemaPath = getCredentialsSchemaPath();

  try {
    if (fs.existsSync(schemaPath)) {
      const content = fs.readFileSync(schemaPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(`[CredentialsLoader] Failed to load schema file, using embedded: ${(error as Error).message}`);
  }

  return EMBEDDED_SCHEMA;
}

/**
 * Validate credentials against JSON Schema
 */
export function validateCredentials(credentials: unknown): CredentialsFile {
  const ajv = createValidator();
  const schema = loadSchema();
  const validate = ajv.compile(schema);

  if (!validate(credentials)) {
    const errors = (validate.errors || []).map((err) => ({
      path: err.instancePath || '/',
      message: err.message || 'Unknown validation error',
    }));

    throw new CredentialsValidationError(
      `Invalid credentials: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      errors
    );
  }

  return credentials as CredentialsFile;
}

/**
 * Load credentials from ~/.config/ponybunny/credentials.json
 * Returns null if file doesn't exist
 * Throws CredentialsValidationError if file is invalid
 */
export function loadCredentialsFile(): CredentialsFile | null {
  const credentialsPath = getCredentialsPath();

  try {
    if (!fs.existsSync(credentialsPath)) {
      return null;
    }

    const content = fs.readFileSync(credentialsPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate against schema
    return validateCredentials(parsed);
  } catch (error) {
    if (error instanceof CredentialsValidationError) {
      throw error;
    }
    console.warn(`[CredentialsLoader] Failed to load credentials: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Get credentials for a specific endpoint from the credentials file
 */
export function getEndpointCredential(endpointId: string): EndpointCredential | null {
  const credentials = loadCredentialsFile();
  if (!credentials?.endpoints) {
    return null;
  }

  return credentials.endpoints[endpointId] || null;
}

/**
 * Save credentials to ~/.config/ponybunny/credentials.json
 * Creates the directory if it doesn't exist
 * Validates credentials before saving
 */
export function saveCredentialsFile(credentials: CredentialsFile): void {
  // Validate before saving
  validateCredentials(credentials);

  const configDir = getConfigDir();
  const credentialsPath = getCredentialsPath();

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  // Add schema reference
  const credentialsWithSchema = {
    $schema: './credentials.schema.json',
    ...credentials,
  };

  // Write with restricted permissions (owner read/write only)
  fs.writeFileSync(credentialsPath, JSON.stringify(credentialsWithSchema, null, 2), {
    mode: 0o600,
  });
}

/**
 * Set credentials for a specific endpoint
 */
export function setEndpointCredential(
  endpointId: string,
  credential: EndpointCredential
): void {
  const credentials = loadCredentialsFile() || { endpoints: {} };

  if (!credentials.endpoints) {
    credentials.endpoints = {};
  }

  credentials.endpoints[endpointId] = credential;
  saveCredentialsFile(credentials);
}

/**
 * Remove credentials for a specific endpoint
 */
export function removeEndpointCredential(endpointId: string): boolean {
  const credentials = loadCredentialsFile();
  if (!credentials?.endpoints || !credentials.endpoints[endpointId]) {
    return false;
  }

  delete credentials.endpoints[endpointId];
  saveCredentialsFile(credentials);
  return true;
}

/**
 * List all configured endpoint IDs
 */
export function listConfiguredEndpoints(): string[] {
  const credentials = loadCredentialsFile();
  if (!credentials?.endpoints) {
    return [];
  }

  return Object.keys(credentials.endpoints);
}

/**
 * Check if credentials file exists
 */
export function credentialsFileExists(): boolean {
  return fs.existsSync(getCredentialsPath());
}

// Cache for credentials to avoid repeated file reads
let credentialsCache: CredentialsFile | null | undefined = undefined;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000; // 5 seconds

/**
 * Get credentials with caching (for performance in hot paths)
 */
export function getCachedCredentials(): CredentialsFile | null {
  const now = Date.now();

  if (credentialsCache === undefined || now - cacheTimestamp > CACHE_TTL_MS) {
    credentialsCache = loadCredentialsFile();
    cacheTimestamp = now;
  }

  return credentialsCache;
}

/**
 * Get endpoint credential with caching
 */
export function getCachedEndpointCredential(endpointId: string): EndpointCredential | null {
  const credentials = getCachedCredentials();
  if (!credentials?.endpoints) {
    return null;
  }

  return credentials.endpoints[endpointId] || null;
}

/**
 * Clear the credentials cache (useful after updates)
 */
export function clearCredentialsCache(): void {
  credentialsCache = undefined;
  cacheTimestamp = 0;
}
