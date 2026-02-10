/**
 * MCP Registry Integration Tests
 * Tests the bridge between MCP tools and PonyBunny's ToolRegistry
 */

import { ToolRegistry } from '../../../../src/infra/tools/tool-registry.js';
import {
  registerMCPTools,
  refreshMCPTools,
  initializeMCPIntegration,
} from '../../../../src/infra/mcp/adapters/registry-integration.js';

// Mock connection manager
const mockInitialize = jest.fn().mockResolvedValue(undefined);
const mockListAllTools = jest.fn().mockResolvedValue(new Map());
const mockDisconnectAll = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../src/infra/mcp/client/connection-manager.js', () => ({
  getMCPConnectionManager: jest.fn(() => ({
    initialize: mockInitialize,
    listAllTools: mockListAllTools,
    disconnectAll: mockDisconnectAll,
    callTool: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'mock result' }],
      isError: false,
    }),
  })),
}));

// Mock tool-provider cache
jest.mock('../../../../src/infra/tools/tool-provider.js', () => ({
  cacheMCPToolSchema: jest.fn(),
  clearMCPToolSchemaCache: jest.fn(),
  getGlobalToolProvider: jest.fn(() => ({
    getToolDefinitions: jest.fn(() => []),
  })),
  setGlobalToolProvider: jest.fn(),
}));

// Mock config loader
jest.mock('../../../../src/infra/mcp/config/mcp-config-loader.js', () => ({
  loadMCPConfig: jest.fn(() => ({
    mcpServers: {
      'test-fs': { enabled: true, transport: 'stdio', command: 'echo' },
    },
  })),
  listEnabledMCPServers: jest.fn(() => ['test-fs']),
}));

describe('MCP Registry Integration', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new ToolRegistry();
  });

  // ============================================
  // registerMCPTools
  // ============================================

  describe('registerMCPTools', () => {
    it('should register tools from all connected servers', async () => {
      mockListAllTools.mockResolvedValueOnce(
        new Map([
          [
            'filesystem',
            [
              { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
              { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
            ],
          ],
        ])
      );

      await registerMCPTools(registry);

      const allTools = registry.getAllTools();
      const mcpTools = allTools.filter(t => t.name.startsWith('mcp__'));

      expect(mcpTools).toHaveLength(2);
      expect(mcpTools.map(t => t.name)).toContain('mcp__filesystem__read_file');
      expect(mcpTools.map(t => t.name)).toContain('mcp__filesystem__write_file');
    });

    it('should register tools from multiple servers', async () => {
      mockListAllTools.mockResolvedValueOnce(
        new Map([
          [
            'fs',
            [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: {} } }],
          ],
          [
            'db',
            [{ name: 'query', description: 'Query DB', inputSchema: { type: 'object', properties: {} } }],
          ],
        ])
      );

      await registerMCPTools(registry);

      const allTools = registry.getAllTools();
      const mcpTools = allTools.filter(t => t.name.startsWith('mcp__'));

      expect(mcpTools).toHaveLength(2);
      expect(mcpTools.map(t => t.name)).toContain('mcp__fs__read_file');
      expect(mcpTools.map(t => t.name)).toContain('mcp__db__query');
    });

    it('should handle empty tool list gracefully', async () => {
      mockListAllTools.mockResolvedValueOnce(new Map());

      await registerMCPTools(registry);

      const allTools = registry.getAllTools();
      expect(allTools).toHaveLength(0);
    });

    it('should set correct metadata on registered tools', async () => {
      mockListAllTools.mockResolvedValueOnce(
        new Map([
          [
            'fs',
            [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } }],
          ],
        ])
      );

      await registerMCPTools(registry);

      const tool = registry.getTool('mcp__fs__read_file');
      expect(tool).toBeDefined();
      expect(tool!.category).toBe('network');
      expect(tool!.riskLevel).toBe('moderate');
      expect(tool!.description).toContain('[MCP:fs]');
    });
  });

  // ============================================
  // refreshMCPTools
  // ============================================

  describe('refreshMCPTools', () => {
    it('should remove old MCP tools and re-register new ones', async () => {
      // First registration
      mockListAllTools.mockResolvedValueOnce(
        new Map([
          ['fs', [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: {} } }]],
        ])
      );
      await registerMCPTools(registry);

      expect(registry.getTool('mcp__fs__read_file')).toBeDefined();

      // Refresh with different tools
      mockListAllTools.mockResolvedValueOnce(
        new Map([
          ['fs', [{ name: 'write_file', description: 'Write', inputSchema: { type: 'object', properties: {} } }]],
        ])
      );

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await refreshMCPTools(registry);
      consoleSpy.mockRestore();

      // Old tool should be gone, new tool should be present
      expect(registry.getTool('mcp__fs__read_file')).toBeUndefined();
      expect(registry.getTool('mcp__fs__write_file')).toBeDefined();
    });

    it('should not remove non-MCP tools during refresh', async () => {
      // Register a non-MCP tool
      registry.register({
        name: 'read_file',
        description: 'Built-in read',
        category: 'filesystem',
        riskLevel: 'safe',
        requiresApproval: false,
        execute: async () => 'ok',
      });

      mockListAllTools.mockResolvedValueOnce(new Map());

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await refreshMCPTools(registry);
      consoleSpy.mockRestore();

      // Built-in tool should still be there
      expect(registry.getTool('read_file')).toBeDefined();
    });

    it('should clear MCP tool schema cache on refresh', async () => {
      const { clearMCPToolSchemaCache } = require('../../../../src/infra/tools/tool-provider.js');

      mockListAllTools.mockResolvedValueOnce(new Map());

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await refreshMCPTools(registry);
      consoleSpy.mockRestore();

      expect(clearMCPToolSchemaCache).toHaveBeenCalled();
    });
  });

  // ============================================
  // initializeMCPIntegration
  // ============================================

  describe('initializeMCPIntegration', () => {
    it('should initialize connection manager and register tools', async () => {
      mockListAllTools.mockResolvedValueOnce(
        new Map([
          ['fs', [{ name: 'read_file', description: 'Read', inputSchema: { type: 'object', properties: {} } }]],
        ])
      );

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await initializeMCPIntegration(registry);
      consoleSpy.mockRestore();

      expect(mockInitialize).toHaveBeenCalled();
      expect(registry.getTool('mcp__fs__read_file')).toBeDefined();
    });
  });
});
