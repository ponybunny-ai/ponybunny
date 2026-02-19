import { accountManager, authManager } from '../../src/cli/lib/auth-manager.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AuthManager', () => {
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `pb-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
    
    // Override internal configDir for accountManager
    (accountManager as any).configDir = testConfigDir;
    (accountManager as any).configPath = join(testConfigDir, 'accounts.json');
    
    // Clear any existing accounts
    authManager.clearConfig();
  });

  afterEach(() => {
    if (existsSync(testConfigDir)) {
      const configPath = join(testConfigDir, 'accounts.json');
      if (existsSync(configPath)) {
        unlinkSync(configPath);
      }
    }
  });

  describe('getConfig', () => {
    test('returns empty object when no config exists', () => {
      const config = authManager.getConfig();
      expect(config).toEqual({});
    });

    test('returns saved config', () => {
      authManager.saveConfig({
        accessToken: 'test-token',
        email: 'test@example.com',
      });

      const config = authManager.getConfig();
      expect(config.accessToken).toBe('test-token');
      expect(config.email).toBe('test@example.com');
    });
  });

  describe('saveConfig', () => {
    test('saves new config', () => {
      authManager.saveConfig({
        accessToken: 'token-123',
        userId: 'user-456',
      });

      const config = authManager.getConfig();
      expect(config.accessToken).toBe('token-123');
      expect(config.userId).toBe('user-456');
    });

    test('merges with existing config', () => {
      authManager.saveConfig({ 
        accessToken: 'token-1',
        email: 'test1@example.com',
      });
      
      // In multi-account system, saveConfig adds a new account
      // We need to update the existing account instead
      authManager.saveConfig({ 
        accessToken: 'token-1',
        email: 'test@example.com',
      });

      const config = authManager.getConfig();
      expect(config.accessToken).toBe('token-1');
      expect(config.email).toBe('test@example.com');
    });
  });

  describe('clearConfig', () => {
    test('clears all config', () => {
      authManager.saveConfig({
        accessToken: 'token',
        email: 'test@example.com',
      });

      authManager.clearConfig();

      const config = authManager.getConfig();
      expect(config).toEqual({});
    });
  });

  describe('isAuthenticated', () => {
    test('returns false when no token', () => {
      expect(authManager.isAuthenticated()).toBe(false);
    });

    test('returns true when valid token exists', () => {
      authManager.saveConfig({
        accessToken: 'valid-token',
        email: 'test@example.com',
      });

      expect(authManager.isAuthenticated()).toBe(true);
    });

    test('returns false when token is expired', () => {
      authManager.saveConfig({
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000,
        email: 'test@example.com',
      });

      expect(authManager.isAuthenticated()).toBe(false);
    });

    test('returns true when refresh token exists even if access token is expired', () => {
      authManager.saveConfig({
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000,
        email: 'test@example.com',
      });

      expect(authManager.isAuthenticated()).toBe(true);
    });

    test('returns true when token not yet expired', () => {
      authManager.saveConfig({
        accessToken: 'valid-token',
        expiresAt: Date.now() + 10000,
        email: 'test@example.com',
      });

      expect(authManager.isAuthenticated()).toBe(true);
    });
  });

  describe('getAccessToken', () => {
    test('returns undefined when no token', async () => {
      const token = await authManager.getAccessToken();
      expect(token).toBeUndefined();
    });

    test('returns access token', async () => {
      authManager.saveConfig({ 
        accessToken: 'my-token',
        email: 'test@example.com',
      });
      
      const token = await authManager.getAccessToken();
      expect(token).toBe('my-token');
    });
  });
});
