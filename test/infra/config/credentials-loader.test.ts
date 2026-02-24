import * as fs from 'fs';
import * as os from 'os';

// We need to mock the module before importing
jest.mock('../../../src/infra/config/credentials-loader.js', () => {
  const actual = jest.requireActual('../../../src/infra/config/credentials-loader.js');
  return {
    ...actual,
  };
});

import {
  getConfigDir,
  getCredentialsPath,
  loadCredentialsFile,
  getEndpointCredential,
  saveCredentialsFile,
  setEndpointCredential,
  removeEndpointCredential,
  listConfiguredEndpoints,
  credentialsFileExists,
  getCachedCredentials,
  getCachedEndpointCredential,
  clearCredentialsCache,
  CredentialsValidationError,
  type CredentialsFile,
} from '../../../src/infra/config/credentials-loader.js';

describe('CredentialsLoader', () => {
  const configDir = getConfigDir();
  const credentialsPath = getCredentialsPath();
  let originalCredentials: string | null = null;

  beforeAll(() => {
    // Backup existing credentials if any
    if (fs.existsSync(credentialsPath)) {
      originalCredentials = fs.readFileSync(credentialsPath, 'utf-8');
    }
  });

  beforeEach(() => {
    clearCredentialsCache();
    // Remove credentials file before each test
    if (fs.existsSync(credentialsPath)) {
      fs.unlinkSync(credentialsPath);
    }
  });

  afterEach(() => {
    clearCredentialsCache();
  });

  afterAll(() => {
    // Restore original credentials
    if (originalCredentials !== null) {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(credentialsPath, originalCredentials, { mode: 0o600 });
    } else if (fs.existsSync(credentialsPath)) {
      fs.unlinkSync(credentialsPath);
    }
  });

  describe('getConfigDir', () => {
    it('should return path under home directory', () => {
      const result = getConfigDir();
      const override = process.env.PONYBUNNY_CONFIG_DIR;

      if (typeof override === 'string' && override.trim()) {
        expect(result).toBe(override);
      } else {
        expect(result).toContain('.ponybunny');
        expect(result).toContain(os.homedir());
      }
    });
  });

  describe('getCredentialsPath', () => {
    it('should return credentials.json path under config dir', () => {
      const result = getCredentialsPath();
      const override = process.env.PONYBUNNY_CONFIG_DIR;

      if (typeof override === 'string' && override.trim()) {
        expect(result.startsWith(override)).toBe(true);
      } else {
        expect(result).toContain('.ponybunny');
      }
      expect(result).toContain('credentials.json');
    });
  });

  describe('loadCredentialsFile', () => {
    it('should return null when file does not exist', () => {
      const result = loadCredentialsFile();
      expect(result).toBeNull();
    });

    it('should load valid credentials file', () => {
      fs.mkdirSync(configDir, { recursive: true });
      const testCreds: CredentialsFile = {
      providers: {
          'anthropic-direct': {
            apiKey: 'test-api-key',
          },
        },
      };
      fs.writeFileSync(credentialsPath, JSON.stringify(testCreds), { mode: 0o600 });

      const result = loadCredentialsFile();
      expect(result).toEqual(testCreds);
    });

    it('should return null for invalid JSON', () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(credentialsPath, 'invalid json', { mode: 0o600 });

      const result = loadCredentialsFile();
      expect(result).toBeNull();
    });

    it('rejects unknown fields in provider credentials payload', () => {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        credentialsPath,
        JSON.stringify({
      providers: {
            'openai-direct': {
              enabled: true,
              apiKey: 'sk-test',
            },
          },
        }),
        { mode: 0o600 }
      );

      expect(() => loadCredentialsFile()).toThrow(CredentialsValidationError);
    });
  });

  describe('getEndpointCredential', () => {
    it('should return null when no credentials file exists', () => {
      const result = getEndpointCredential('anthropic-direct');
      expect(result).toBeNull();
    });

    it('should return null when endpoint not configured', () => {
      fs.mkdirSync(configDir, { recursive: true });
      const testCreds: CredentialsFile = {
      providers: {
          'openai-direct': { apiKey: 'test-key' },
        },
      };
      fs.writeFileSync(credentialsPath, JSON.stringify(testCreds), { mode: 0o600 });

      const result = getEndpointCredential('anthropic-direct');
      expect(result).toBeNull();
    });

    it('should return credential for configured endpoint', () => {
      fs.mkdirSync(configDir, { recursive: true });
      const testCreds: CredentialsFile = {
      providers: {
          'anthropic-direct': { apiKey: 'test-api-key' },
        },
      };
      fs.writeFileSync(credentialsPath, JSON.stringify(testCreds), { mode: 0o600 });

      const result = getEndpointCredential('anthropic-direct');
      expect(result).toEqual({ apiKey: 'test-api-key' });
    });
  });

  describe('saveCredentialsFile', () => {
    it('should create config directory and file', () => {
      // Just test that save works - directory may already exist
      const testCreds: CredentialsFile = {
      providers: {
          'anthropic-direct': { apiKey: 'test-key' },
        },
      };

      saveCredentialsFile(testCreds);

      expect(fs.existsSync(configDir)).toBe(true);
      expect(fs.existsSync(credentialsPath)).toBe(true);
    });

    it('should save credentials with correct content', () => {
      const testCreds: CredentialsFile = {
      providers: {
          'anthropic-direct': { apiKey: 'test-key' },
          'aws-bedrock': {
            accessKeyId: 'aws-id',
            secretAccessKey: 'aws-secret',
            region: 'us-west-2',
          },
        },
      };

      saveCredentialsFile(testCreds);

      const content = fs.readFileSync(credentialsPath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual({
        $schema: 'https://ponybunny.dho.ai/schemas/credentials.schema.json',
        ...testCreds,
      });
    });

    it('should set restrictive file permissions', () => {
    const testCreds: CredentialsFile = { providers: {} };
      saveCredentialsFile(testCreds);

      const stats = fs.statSync(credentialsPath);
      // Check that only owner has read/write (0o600 = 384 in decimal)
      expect(stats.mode & 0o777).toBe(0o600);
    });
  });

  describe('setEndpointCredential', () => {
    it('should create new credentials file if not exists', () => {
      setEndpointCredential('anthropic-direct', { apiKey: 'new-key' });

      const result = loadCredentialsFile();
    expect(result?.providers?.['anthropic-direct']).toEqual({ apiKey: 'new-key' });
    });

    it('should add endpoint to existing credentials', () => {
      // Create initial credentials
      saveCredentialsFile({
      providers: {
          'openai-direct': { apiKey: 'openai-key' },
        },
      });

      setEndpointCredential('anthropic-direct', { apiKey: 'anthropic-key' });

      const result = loadCredentialsFile();
    expect(result?.providers?.['openai-direct']).toEqual({ apiKey: 'openai-key' });
    expect(result?.providers?.['anthropic-direct']).toEqual({ apiKey: 'anthropic-key' });
    });

    it('should update existing endpoint credential', () => {
      saveCredentialsFile({
      providers: {
          'anthropic-direct': { apiKey: 'old-key' },
        },
      });

      setEndpointCredential('anthropic-direct', { apiKey: 'new-key' });

      const result = loadCredentialsFile();
    expect(result?.providers?.['anthropic-direct']).toEqual({ apiKey: 'new-key' });
    });
  });

  describe('removeEndpointCredential', () => {
    it('should return false when no credentials file exists', () => {
      const result = removeEndpointCredential('anthropic-direct');
      expect(result).toBe(false);
    });

    it('should return false when endpoint not configured', () => {
      saveCredentialsFile({
      providers: {
          'openai-direct': { apiKey: 'key' },
        },
      });

      const result = removeEndpointCredential('anthropic-direct');
      expect(result).toBe(false);
    });

    it('should remove endpoint and return true', () => {
      saveCredentialsFile({
      providers: {
          'anthropic-direct': { apiKey: 'key' },
          'openai-direct': { apiKey: 'key2' },
        },
      });

      const result = removeEndpointCredential('anthropic-direct');
      expect(result).toBe(true);

      const creds = loadCredentialsFile();
    expect(creds?.providers?.['anthropic-direct']).toBeUndefined();
    expect(creds?.providers?.['openai-direct']).toEqual({ apiKey: 'key2' });
    });
  });

  describe('listConfiguredEndpoints', () => {
    it('should return empty array when no credentials file', () => {
      const result = listConfiguredEndpoints();
      expect(result).toEqual([]);
    });

    it('should return empty array when no endpoints configured', () => {
    saveCredentialsFile({ providers: {} });

      const result = listConfiguredEndpoints();
      expect(result).toEqual([]);
    });

    it('should return list of configured endpoint IDs', () => {
      saveCredentialsFile({
      providers: {
          'anthropic-direct': { apiKey: 'key1' },
          'openai-direct': { apiKey: 'key2' },
          'aws-bedrock': { accessKeyId: 'id', secretAccessKey: 'secret' },
        },
      });

      const result = listConfiguredEndpoints();
      expect(result).toContain('anthropic-direct');
      expect(result).toContain('openai-direct');
      expect(result).toContain('aws-bedrock');
      expect(result).toHaveLength(3);
    });
  });

  describe('credentialsFileExists', () => {
    it('should return false when file does not exist', () => {
      expect(credentialsFileExists()).toBe(false);
    });

    it('should return true when file exists', () => {
    saveCredentialsFile({ providers: {} });
      expect(credentialsFileExists()).toBe(true);
    });
  });

  describe('caching', () => {
    it('should cache credentials', () => {
      saveCredentialsFile({
      providers: {
          'anthropic-direct': { apiKey: 'cached-key' },
        },
      });

      // First call loads from file
      const result1 = getCachedCredentials();
    expect(result1?.providers?.['anthropic-direct']?.apiKey).toBe('cached-key');

      // Modify file directly
      fs.writeFileSync(
        credentialsPath,
      JSON.stringify({ providers: { 'anthropic-direct': { apiKey: 'new-key' } } }),
        { mode: 0o600 }
      );

      // Should still return cached value
      const result2 = getCachedCredentials();
    expect(result2?.providers?.['anthropic-direct']?.apiKey).toBe('cached-key');
    });

    it('should clear cache', () => {
      saveCredentialsFile({
      providers: {
          'anthropic-direct': { apiKey: 'original-key' },
        },
      });

      getCachedCredentials();

      // Modify file
      fs.writeFileSync(
        credentialsPath,
      JSON.stringify({ providers: { 'anthropic-direct': { apiKey: 'updated-key' } } }),
        { mode: 0o600 }
      );

      // Clear cache
      clearCredentialsCache();

      // Should now return new value
      const result = getCachedCredentials();
    expect(result?.providers?.['anthropic-direct']?.apiKey).toBe('updated-key');
    });

    it('should get cached endpoint credential', () => {
      saveCredentialsFile({
      providers: {
          'anthropic-direct': { apiKey: 'test-key' },
        },
      });

      const result = getCachedEndpointCredential('anthropic-direct');
      expect(result?.apiKey).toBe('test-key');
    });
  });
});
