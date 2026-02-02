import { AuthManager } from '../../src/cli/lib/auth-manager.js';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AuthManager', () => {
  let authManager: AuthManager;
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `pb-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
    
    authManager = new AuthManager();
    (authManager as any).configDir = testConfigDir;
    (authManager as any).configPath = join(testConfigDir, 'auth.json');
  });

  afterEach(() => {
    if (existsSync(testConfigDir)) {
      const configPath = join(testConfigDir, 'auth.json');
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
      authManager.saveConfig({ accessToken: 'token-1' });
      authManager.saveConfig({ email: 'test@example.com' });

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
      });

      expect(authManager.isAuthenticated()).toBe(true);
    });

    test('returns false when token is expired', () => {
      authManager.saveConfig({
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000,
      });

      expect(authManager.isAuthenticated()).toBe(false);
    });

    test('returns true when token not yet expired', () => {
      authManager.saveConfig({
        accessToken: 'valid-token',
        expiresAt: Date.now() + 10000,
      });

      expect(authManager.isAuthenticated()).toBe(true);
    });
  });

  describe('getAccessToken', () => {
    test('returns undefined when no token', () => {
      expect(authManager.getAccessToken()).toBeUndefined();
    });

    test('returns access token', () => {
      authManager.saveConfig({ accessToken: 'my-token' });
      expect(authManager.getAccessToken()).toBe('my-token');
    });
  });

  describe('getGatewayUrl', () => {
    test('returns default gateway when not set', () => {
      expect(authManager.getGatewayUrl()).toBe('https://api.ponybunny.ai');
    });

    test('returns custom gateway when set', () => {
      authManager.saveConfig({ gatewayUrl: 'https://custom.gateway.com' });
      expect(authManager.getGatewayUrl()).toBe('https://custom.gateway.com');
    });
  });
});
