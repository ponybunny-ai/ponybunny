import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Credentials for a specific endpoint
 */
export interface EndpointCredential {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  endpoint?: string;
  projectId?: string;
}

/**
 * Structure of ~/.ponybunny/credentials.json
 */
export interface CredentialsFile {
  endpoints?: Record<string, EndpointCredential>;
}

/**
 * Get the PonyBunny config directory path
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.ponybunny');
}

/**
 * Get the credentials file path
 */
export function getCredentialsPath(): string {
  return path.join(getConfigDir(), 'credentials.json');
}

/**
 * Load credentials from ~/.ponybunny/credentials.json
 * Returns null if file doesn't exist or is invalid
 */
export function loadCredentialsFile(): CredentialsFile | null {
  const credentialsPath = getCredentialsPath();

  try {
    if (!fs.existsSync(credentialsPath)) {
      return null;
    }

    const content = fs.readFileSync(credentialsPath, 'utf-8');
    const parsed = JSON.parse(content) as CredentialsFile;

    return parsed;
  } catch (error) {
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
 * Save credentials to ~/.ponybunny/credentials.json
 * Creates the directory if it doesn't exist
 */
export function saveCredentialsFile(credentials: CredentialsFile): void {
  const configDir = getConfigDir();
  const credentialsPath = getCredentialsPath();

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  // Write with restricted permissions (owner read/write only)
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), {
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
