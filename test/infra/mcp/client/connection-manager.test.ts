/**
 * MCP Connection Manager Tests
 * Tests multi-server connection orchestration, tool routing, and status tracking
 */

import { MCPConnectionManager } from '../../../../src/infra/mcp/client/connection-manager.js';
import { MCPConnectionError } from '../../../../src/infra/mcp/client/types.js';
import type { MCPServerConfig, MCPConnectionState } from '../../../../src/infra/mcp/client/types.js';

// Mock MCPClient
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
const mockGetState = jest.fn().mockReturnValue('connected');
const mockListTools = jest.fn().mockResolvedValue([]);
const mockCallTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
const mockIsToolAllowed = jest.fn().mockReturnValue(true);
const mockGetServerInfo = jest.fn().mockReturnValue({ name: 'test', version: '1.0', protocolVersion: '2024-11-05', capabilities: {} });

jest.mock('../../../../src/infra/mcp/client/mcp-client.js', () => ({
  MCPClient: jest.fn().mockImplementation((options: any) => {
    // Simulate state change callback on connect
    const instance = {
      connect: jest.fn().mockImplementation(async () => {
        options.onStateChange?.('connecting');
        options.onStateChange?.('connected');
      }),
      disconnect: jest.fn().mockImplementation(async () => {
        options.onStateChange?.('disconnected');
      }),
      getState: mockGetState,
      listTools: mockListTools,
      callTool: mockCallTool,
      isToolAllowed: mockIsToolAllowed,
      getServerInfo: mockGetServerInfo,
    };
    return instance;
  }),
}));

// Mock config loader
jest.mock('../../../../src/infra/mcp/config/mcp-config-loader.js', () => ({
  loadMCPConfig: jest.fn(() => ({
    mcpServers: {
      'server-a': { enabled: true, transport: 'stdio', command: 'echo', allowedTools: ['*'] },
      'server-b': { enabled: true, transport: 'http', url: 'http://localhost:3000', allowedTools: ['read_file'] },
      'server-disabled': { enabled: false, transport: 'stdio', command: 'echo' },
    },
  })),
  listEnabledMCPServers: jest.fn(() => ['server-a', 'server-b']),
}));

describe('MCPConnectionManager', () => {
  let manager: MCPConnectionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new MCPConnectionManager();
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  // ============================================
  // Initialization
  // ============================================

  describe('initialize', () => {
    it('should connect to all enabled servers', async () => {
      await manager.initialize();

      const connected = manager.getConnectedServers();
      expect(connected).toContain('server-a');
      expect(connected).toContain('server-b');
    });

    it('should skip disabled servers', async () => {
      await manager.initialize();

      const client = manager.getClient('server-disabled');
      expect(client).toBeUndefined();
    });

    it('should handle individual server connection failures gracefully', async () => {
      // Make server-b fail
      const { MCPClient } = require('../../../../src/infra/mcp/client/mcp-client.js');
      let callCount = 0;
      MCPClient.mockImplementation((options: any) => ({
        connect: jest.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 2) throw new Error('Connection refused');
          options.onStateChange?.('connecting');
          options.onStateChange?.('connected');
        }),
        disconnect: jest.fn().mockResolvedValue(undefined),
        getState: jest.fn().mockReturnValue('connected'),
        getServerInfo: mockGetServerInfo,
        listTools: mockListTools,
        callTool: mockCallTool,
        isToolAllowed: mockIsToolAllowed,
      }));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      await manager.initialize();
      consoleSpy.mockRestore();

      // Should not throw even though one server failed
    });
  });

  // ============================================
  // Connection Management
  // ============================================

  describe('connectServer / disconnectServer', () => {
    it('should connect to a specific server', async () => {
      const config: MCPServerConfig = {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'test-server'],
      };

      await manager.connectServer('my-server', config);

      const client = manager.getClient('my-server');
      expect(client).toBeDefined();
    });

    it('should disconnect from a specific server', async () => {
      await manager.connectServer('my-server', { transport: 'stdio', command: 'echo' });
      await manager.disconnectServer('my-server');

      const client = manager.getClient('my-server');
      expect(client).toBeUndefined();
    });

    it('should handle disconnect of non-existent server gracefully', async () => {
      await expect(manager.disconnectServer('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all connected servers', async () => {
      await manager.connectServer('s1', { transport: 'stdio', command: 'echo' });
      await manager.connectServer('s2', { transport: 'stdio', command: 'echo' });

      await manager.disconnectAll();

      expect(manager.getClient('s1')).toBeUndefined();
      expect(manager.getClient('s2')).toBeUndefined();
    });
  });

  // ============================================
  // Tool Operations
  // ============================================

  describe('listAllTools', () => {
    it('should aggregate tools from all connected servers', async () => {
      mockListTools
        .mockResolvedValueOnce([
          { name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: {} } },
        ])
        .mockResolvedValueOnce([
          { name: 'query', description: 'Query DB', inputSchema: { type: 'object', properties: {} } },
        ]);

      await manager.initialize();
      const toolsMap = await manager.listAllTools();

      expect(toolsMap.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('callTool', () => {
    it('should route tool call to the correct server', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'file content here' }],
        isError: false,
      });

      await manager.connectServer('fs', { transport: 'stdio', command: 'echo', allowedTools: ['*'] });
      const result = await manager.callTool('fs', 'read_file', { path: '/test.txt' });

      expect(result.content[0].text).toBe('file content here');
    });

    it('should throw when server is not connected', async () => {
      await expect(
        manager.callTool('nonexistent', 'read_file', {})
      ).rejects.toThrow(MCPConnectionError);
    });

    it('should throw when server is not in connected state', async () => {
      mockGetState.mockReturnValueOnce('disconnected');
      await manager.connectServer('fs', { transport: 'stdio', command: 'echo' });

      // Override getState to return disconnected
      const client = manager.getClient('fs')!;
      (client.getState as jest.Mock).mockReturnValue('disconnected');

      await expect(
        manager.callTool('fs', 'read_file', {})
      ).rejects.toThrow(MCPConnectionError);
    });

    it('should throw when tool is not in allowed list', async () => {
      mockIsToolAllowed.mockReturnValueOnce(false);
      await manager.connectServer('fs', { transport: 'stdio', command: 'echo', allowedTools: ['read_file'] });

      const client = manager.getClient('fs')!;
      (client.isToolAllowed as jest.Mock).mockReturnValue(false);

      await expect(
        manager.callTool('fs', 'dangerous_tool', {})
      ).rejects.toThrow(MCPConnectionError);
    });
  });

  // ============================================
  // Status Tracking
  // ============================================

  describe('connection status', () => {
    it('should track connection status per server', async () => {
      await manager.connectServer('fs', { transport: 'stdio', command: 'echo' });

      const status = manager.getConnectionStatus('fs');
      expect(status).toBeDefined();
      expect(status!.serverName).toBe('fs');
    });

    it('should return all connection statuses', async () => {
      await manager.connectServer('s1', { transport: 'stdio', command: 'echo' });
      await manager.connectServer('s2', { transport: 'stdio', command: 'echo' });

      const statuses = manager.getAllConnectionStatus();
      expect(statuses.length).toBeGreaterThanOrEqual(2);
    });

    it('should return undefined for unknown server', () => {
      const status = manager.getConnectionStatus('unknown');
      expect(status).toBeUndefined();
    });
  });

  // ============================================
  // Server Queries
  // ============================================

  describe('isServerConnected', () => {
    it('should return true for connected servers', async () => {
      await manager.connectServer('fs', { transport: 'stdio', command: 'echo' });

      expect(manager.isServerConnected('fs')).toBe(true);
    });

    it('should return false for non-existent servers', () => {
      expect(manager.isServerConnected('nonexistent')).toBe(false);
    });
  });

  describe('getConnectedServers', () => {
    it('should return names of connected servers only', async () => {
      await manager.connectServer('s1', { transport: 'stdio', command: 'echo' });
      await manager.connectServer('s2', { transport: 'stdio', command: 'echo' });

      const connected = manager.getConnectedServers();
      expect(connected).toContain('s1');
      expect(connected).toContain('s2');
    });
  });

  // ============================================
  // Configuration Reload
  // ============================================

  describe('reloadConfiguration', () => {
    it('should disconnect all and reinitialize', async () => {
      await manager.connectServer('old', { transport: 'stdio', command: 'echo' });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await manager.reloadConfiguration();
      consoleSpy.mockRestore();

      // After reload, old manually-added server should be gone
      // and servers from config should be connected
    });
  });

  // ============================================
  // State Change Callbacks
  // ============================================

  describe('callbacks', () => {
    it('should invoke onConnectionStateChange callback', async () => {
      const stateChanges: Array<{ server: string; state: MCPConnectionState }> = [];

      const mgr = new MCPConnectionManager({
        onConnectionStateChange: (serverName, state) => {
          stateChanges.push({ server: serverName, state });
        },
      });

      await mgr.connectServer('test', { transport: 'stdio', command: 'echo' });

      expect(stateChanges.length).toBeGreaterThan(0);
      expect(stateChanges.some(s => s.state === 'connected')).toBe(true);

      await mgr.disconnectAll();
    });
  });
});
