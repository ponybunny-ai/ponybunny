/**
 * MCP Config Loader Tests
 * Tests configuration loading, validation, env var expansion, and caching
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  validateMCPConfig,
  loadMCPConfig,
  saveMCPConfig,
  setMCPServerConfig,
  removeMCPServerConfig,
  listMCPServers,
  listEnabledMCPServers,
  getCachedMCPConfig,
  clearMCPConfigCache,
  getMCPConfigPath,
} from '../../../../src/infra/mcp/config/mcp-config-loader.js';
import { MCPConfigError } from '../../../../src/infra/mcp/client/types.js';
import type { MCPConfig } from '../../../../src/infra/mcp/client/types.js';

// Mock fs module
jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock credentials-loader to prevent filesystem access
jest.mock('../../../../src/infra/config/credentials-loader.js', () => ({
  getConfigDir: jest.fn(() => '/tmp/test-ponybunny'),
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));

describe('MCP Config Loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearMCPConfigCache();
  });

  // ============================================
  // Schema Validation
  // ============================================

  describe('validateMCPConfig', () => {
    it('should validate a minimal valid config', () => {
      const config = {
        mcpServers: {},
      };

      const result = validateMCPConfig(config);
      expect(result).toEqual(config);
    });

    it('should validate a config with stdio server', () => {
      const config: MCPConfig = {
        mcpServers: {
          filesystem: {
            enabled: true,
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
            allowedTools: ['*'],
            autoReconnect: true,
            timeout: 30000,
          },
        },
      };

      const result = validateMCPConfig(config);
      expect(result.mcpServers.filesystem.transport).toBe('stdio');
      expect(result.mcpServers.filesystem.command).toBe('npx');
    });

    it('should validate a config with http server', () => {
      const config: MCPConfig = {
        mcpServers: {
          remote: {
            enabled: true,
            transport: 'http',
            url: 'http://localhost:3000/mcp',
            headers: { 'Authorization': 'Bearer token123' },
            allowedTools: ['read_file', 'write_file'],
            timeout: 60000,
          },
        },
      };

      const result = validateMCPConfig(config);
      expect(result.mcpServers.remote.transport).toBe('http');
      expect(result.mcpServers.remote.url).toBe('http://localhost:3000/mcp');
    });

    it('should validate a config with multiple servers', () => {
      const config: MCPConfig = {
        mcpServers: {
          fs: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
          },
          api: {
            transport: 'http',
            url: 'http://localhost:8080/mcp',
          },
          disabled: {
            enabled: false,
            transport: 'stdio',
            command: 'echo',
          },
        },
      };

      const result = validateMCPConfig(config);
      expect(Object.keys(result.mcpServers)).toHaveLength(3);
    });

    it('should reject config without transport', () => {
      const config = {
        mcpServers: {
          invalid: {
            command: 'npx',
          },
        },
      };

      expect(() => validateMCPConfig(config)).toThrow(MCPConfigError);
    });

    it('should reject config with invalid transport', () => {
      const config = {
        mcpServers: {
          invalid: {
            transport: 'grpc', // Not supported
          },
        },
      };

      expect(() => validateMCPConfig(config)).toThrow(MCPConfigError);
    });

    it('should reject config with extra properties', () => {
      const config = {
        mcpServers: {},
        extraField: 'not allowed',
      };

      expect(() => validateMCPConfig(config)).toThrow(MCPConfigError);
    });

    it('should reject config with timeout out of range', () => {
      const config = {
        mcpServers: {
          server: {
            transport: 'stdio',
            command: 'npx',
            timeout: 500, // Below minimum 1000
          },
        },
      };

      expect(() => validateMCPConfig(config)).toThrow(MCPConfigError);
    });

    it('should accept $schema property', () => {
      const config = {
        $schema: './mcp-config.schema.json',
        mcpServers: {},
      };

      const result = validateMCPConfig(config);
      expect(result).toBeDefined();
    });
  });

  // ============================================
  // Config Loading
  // ============================================

  describe('loadMCPConfig', () => {
    it('should return null when config file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = loadMCPConfig();
      expect(result).toBeNull();
    });

    it('should load and parse valid config file', () => {
      const configContent = JSON.stringify({
        mcpServers: {
          filesystem: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
          },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = loadMCPConfig();
      expect(result).not.toBeNull();
      expect(result!.mcpServers.filesystem.transport).toBe('stdio');
    });

    it('should expand environment variables in env field', () => {
      const originalEnv = process.env.TEST_MCP_KEY;
      process.env.TEST_MCP_KEY = 'secret-value';

      const configContent = JSON.stringify({
        mcpServers: {
          server: {
            transport: 'stdio',
            command: 'npx',
            env: { API_KEY: '${TEST_MCP_KEY}' },
          },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = loadMCPConfig();
      expect(result!.mcpServers.server.env!.API_KEY).toBe('secret-value');

      // Cleanup
      if (originalEnv === undefined) {
        delete process.env.TEST_MCP_KEY;
      } else {
        process.env.TEST_MCP_KEY = originalEnv;
      }
    });

    it('should expand environment variables in headers', () => {
      const originalEnv = process.env.TEST_MCP_TOKEN;
      process.env.TEST_MCP_TOKEN = 'bearer-token-123';

      const configContent = JSON.stringify({
        mcpServers: {
          api: {
            transport: 'http',
            url: 'http://localhost:3000',
            headers: { Authorization: 'Bearer ${TEST_MCP_TOKEN}' },
          },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = loadMCPConfig();
      expect(result!.mcpServers.api.headers!.Authorization).toBe('Bearer bearer-token-123');

      if (originalEnv === undefined) {
        delete process.env.TEST_MCP_TOKEN;
      } else {
        process.env.TEST_MCP_TOKEN = originalEnv;
      }
    });

    it('should expand environment variables in url', () => {
      const originalEnv = process.env.TEST_MCP_HOST;
      process.env.TEST_MCP_HOST = 'api.example.com';

      const configContent = JSON.stringify({
        mcpServers: {
          api: {
            transport: 'http',
            url: 'https://${TEST_MCP_HOST}/mcp',
          },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = loadMCPConfig();
      expect(result!.mcpServers.api.url).toBe('https://api.example.com/mcp');

      if (originalEnv === undefined) {
        delete process.env.TEST_MCP_HOST;
      } else {
        process.env.TEST_MCP_HOST = originalEnv;
      }
    });

    it('should replace undefined env vars with empty string', () => {
      delete process.env.NONEXISTENT_VAR_12345;

      const configContent = JSON.stringify({
        mcpServers: {
          server: {
            transport: 'stdio',
            command: 'npx',
            env: { KEY: '${NONEXISTENT_VAR_12345}' },
          },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = loadMCPConfig();
      expect(result!.mcpServers.server.env!.KEY).toBe('');
    });

    it('should return null and warn on invalid JSON', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('not-valid-json');

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const result = loadMCPConfig();
      expect(result).toBeNull();
      warnSpy.mockRestore();
    });

    it('should throw MCPConfigError on schema validation failure', () => {
      const configContent = JSON.stringify({
        mcpServers: {
          server: {
            transport: 'invalid-transport',
          },
        },
      });

      // First existsSync call is for config path (true),
      // second is for schema path — return false to force embedded schema fallback
      mockedFs.existsSync
        .mockReturnValueOnce(true)   // config file exists
        .mockReturnValueOnce(false); // schema file does not exist → use embedded
      mockedFs.readFileSync.mockReturnValue(configContent);

      expect(() => loadMCPConfig()).toThrow(MCPConfigError);
    });
  });

  // ============================================
  // Server Listing
  // ============================================

  describe('listMCPServers', () => {
    it('should return empty array when no config exists', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = listMCPServers();
      expect(result).toEqual([]);
    });

    it('should return all server names', () => {
      const configContent = JSON.stringify({
        mcpServers: {
          server1: { transport: 'stdio', command: 'echo' },
          server2: { transport: 'http', url: 'http://localhost:3000' },
          server3: { enabled: false, transport: 'stdio', command: 'echo' },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = listMCPServers();
      expect(result).toHaveLength(3);
      expect(result).toContain('server1');
      expect(result).toContain('server2');
      expect(result).toContain('server3');
    });
  });

  describe('listEnabledMCPServers', () => {
    it('should return only enabled servers', () => {
      const configContent = JSON.stringify({
        mcpServers: {
          enabled1: { transport: 'stdio', command: 'echo' },
          enabled2: { enabled: true, transport: 'stdio', command: 'echo' },
          disabled: { enabled: false, transport: 'stdio', command: 'echo' },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = listEnabledMCPServers();
      expect(result).toHaveLength(2);
      expect(result).toContain('enabled1');
      expect(result).toContain('enabled2');
      expect(result).not.toContain('disabled');
    });

    it('should treat servers without enabled field as enabled', () => {
      const configContent = JSON.stringify({
        mcpServers: {
          implicit: { transport: 'stdio', command: 'echo' },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result = listEnabledMCPServers();
      expect(result).toContain('implicit');
    });
  });

  // ============================================
  // Config Caching
  // ============================================

  describe('getCachedMCPConfig', () => {
    it('should cache config on first call', () => {
      const configContent = JSON.stringify({
        mcpServers: { s: { transport: 'stdio', command: 'echo' } },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      const result1 = getCachedMCPConfig();
      const result2 = getCachedMCPConfig();

      expect(result1).toEqual(result2);
      // readFileSync should only be called once (for the first load)
      // Note: existsSync may be called multiple times (config + schema)
      const readCalls = mockedFs.readFileSync.mock.calls.length;
      expect(readCalls).toBeLessThanOrEqual(2); // config file + potentially schema file
    });

    it('should return null from cache when no config file exists', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = getCachedMCPConfig();
      expect(result).toBeNull();
    });

    it('should clear cache when clearMCPConfigCache is called', () => {
      const configContent = JSON.stringify({
        mcpServers: { s: { transport: 'stdio', command: 'echo' } },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(configContent);

      getCachedMCPConfig();
      clearMCPConfigCache();

      // After clearing, next call should read from disk again
      getCachedMCPConfig();

      // readFileSync should have been called at least twice (once per load)
      expect(mockedFs.readFileSync.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================
  // Config CRUD
  // ============================================

  describe('saveMCPConfig', () => {
    it('should validate and write config to file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      const config: MCPConfig = {
        mcpServers: {
          test: { transport: 'stdio', command: 'echo' },
        },
      };

      saveMCPConfig(config);

      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        (mockedFs.writeFileSync.mock.calls[0] as any[])[1] as string
      );
      expect(writtenContent.mcpServers.test.transport).toBe('stdio');
      expect(writtenContent.$schema).toBe('./mcp-config.schema.json');
    });

    it('should create directory if it does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockImplementation(() => undefined as any);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      const config: MCPConfig = {
        mcpServers: {},
      };

      saveMCPConfig(config);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true, mode: 0o700 })
      );
    });

    it('should throw on invalid config', () => {
      const invalidConfig = {
        mcpServers: {
          bad: { transport: 'invalid' },
        },
      } as any;

      expect(() => saveMCPConfig(invalidConfig)).toThrow(MCPConfigError);
    });
  });

  describe('setMCPServerConfig', () => {
    it('should add a new server to existing config', () => {
      const existingConfig = JSON.stringify({
        mcpServers: {
          existing: { transport: 'stdio', command: 'echo' },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(existingConfig);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      setMCPServerConfig('new-server', {
        transport: 'http',
        url: 'http://localhost:3000',
      });

      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      const writtenContent = JSON.parse(
        (mockedFs.writeFileSync.mock.calls[0] as any[])[1] as string
      );
      expect(writtenContent.mcpServers.existing).toBeDefined();
      expect(writtenContent.mcpServers['new-server']).toBeDefined();
    });

    it('should create config from scratch when no file exists', () => {
      // First existsSync call for config file (loadMCPConfig) returns false
      // Second existsSync call for directory check (saveMCPConfig) returns false
      mockedFs.existsSync.mockReturnValue(false);
      mockedFs.mkdirSync.mockImplementation(() => undefined as any);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      setMCPServerConfig('new-server', {
        transport: 'stdio',
        command: 'echo',
      });

      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('removeMCPServerConfig', () => {
    it('should remove an existing server', () => {
      const existingConfig = JSON.stringify({
        mcpServers: {
          keep: { transport: 'stdio', command: 'echo' },
          remove: { transport: 'stdio', command: 'echo' },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(existingConfig);
      mockedFs.writeFileSync.mockImplementation(() => undefined);

      const result = removeMCPServerConfig('remove');
      expect(result).toBe(true);

      const writtenContent = JSON.parse(
        (mockedFs.writeFileSync.mock.calls[0] as any[])[1] as string
      );
      expect(writtenContent.mcpServers.keep).toBeDefined();
      expect(writtenContent.mcpServers.remove).toBeUndefined();
    });

    it('should return false when server does not exist', () => {
      const existingConfig = JSON.stringify({
        mcpServers: {
          existing: { transport: 'stdio', command: 'echo' },
        },
      });

      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(existingConfig);

      const result = removeMCPServerConfig('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false when no config file exists', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = removeMCPServerConfig('any');
      expect(result).toBe(false);
    });
  });
});
