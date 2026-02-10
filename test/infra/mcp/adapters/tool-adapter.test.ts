/**
 * MCP Tool Adapter Tests
 * Tests tool name namespacing, schema caching, adaptation, and parsing
 */

import {
  adaptMCPTool,
  adaptMCPTools,
  extractMCPToolName,
  isMCPTool,
  describeMCPToolParameters,
} from '../../../../src/infra/mcp/adapters/tool-adapter.js';
import { cacheMCPToolSchema, clearMCPToolSchemaCache } from '../../../../src/infra/tools/tool-provider.js';
import type { MCPToolDefinition } from '../../../../src/infra/mcp/client/types.js';

// Mock connection-manager to prevent real MCP connections
jest.mock('../../../../src/infra/mcp/client/connection-manager.js', () => ({
  getMCPConnectionManager: jest.fn(() => ({
    callTool: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'mock result' }],
      isError: false,
    }),
  })),
}));

// Mock tool-provider cache functions
jest.mock('../../../../src/infra/tools/tool-provider.js', () => ({
  cacheMCPToolSchema: jest.fn(),
  clearMCPToolSchemaCache: jest.fn(),
  getGlobalToolProvider: jest.fn(() => ({
    getToolDefinitions: jest.fn(() => []),
    getToolSummaries: jest.fn(() => []),
  })),
  setGlobalToolProvider: jest.fn(),
}));

describe('MCP Tool Adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // Tool Name Namespacing
  // ============================================

  describe('adaptMCPTool', () => {
    const createMCPTool = (overrides: Partial<MCPToolDefinition> = {}): MCPToolDefinition => ({
      name: 'read_file',
      description: 'Read a file from the filesystem',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
      ...overrides,
    });

    it('should create namespaced tool name with double underscore separator', () => {
      const mcpTool = createMCPTool();
      const adapted = adaptMCPTool('filesystem', mcpTool);

      expect(adapted.name).toBe('mcp__filesystem__read_file');
    });

    it('should preserve server names with hyphens', () => {
      const mcpTool = createMCPTool();
      const adapted = adaptMCPTool('my-server', mcpTool);

      expect(adapted.name).toBe('mcp__my-server__read_file');
    });

    it('should preserve server names with underscores', () => {
      const mcpTool = createMCPTool();
      const adapted = adaptMCPTool('my_server', mcpTool);

      expect(adapted.name).toBe('mcp__my_server__read_file');
    });

    it('should set category to network', () => {
      const mcpTool = createMCPTool();
      const adapted = adaptMCPTool('server', mcpTool);

      expect(adapted.category).toBe('network');
    });

    it('should set risk level to moderate', () => {
      const mcpTool = createMCPTool();
      const adapted = adaptMCPTool('server', mcpTool);

      expect(adapted.riskLevel).toBe('moderate');
    });

    it('should prefix description with [MCP:serverName]', () => {
      const mcpTool = createMCPTool({ description: 'Read a file' });
      const adapted = adaptMCPTool('fs', mcpTool);

      expect(adapted.description).toBe('[MCP:fs] Read a file');
    });

    it('should cache inputSchema via cacheMCPToolSchema', () => {
      const mcpTool = createMCPTool();
      adaptMCPTool('fs', mcpTool);

      expect(cacheMCPToolSchema).toHaveBeenCalledWith(
        'mcp__fs__read_file',
        mcpTool.inputSchema
      );
    });

    it('should create executable tool that calls connection manager', async () => {
      const mcpTool = createMCPTool();
      const adapted = adaptMCPTool('fs', mcpTool);

      const result = await adapted.execute(
        { path: '/test/file.txt' },
        { cwd: '/workspace', allowlist: {} as any, enforcer: {} as any }
      );

      expect(result).toBe('mock result');
    });
  });

  describe('adaptMCPTools', () => {
    it('should adapt multiple tools at once', () => {
      const tools: MCPToolDefinition[] = [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'write_file',
          description: 'Write a file',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ];

      const adapted = adaptMCPTools('fs', tools);

      expect(adapted).toHaveLength(2);
      expect(adapted[0].name).toBe('mcp__fs__read_file');
      expect(adapted[1].name).toBe('mcp__fs__write_file');
    });

    it('should return empty array for empty input', () => {
      const adapted = adaptMCPTools('fs', []);
      expect(adapted).toHaveLength(0);
    });
  });

  // ============================================
  // Tool Name Parsing
  // ============================================

  describe('extractMCPToolName', () => {
    it('should extract server and tool name from simple names', () => {
      const result = extractMCPToolName('mcp__filesystem__read_file');

      expect(result).toEqual({
        serverName: 'filesystem',
        toolName: 'read_file',
      });
    });

    it('should handle server names with hyphens', () => {
      const result = extractMCPToolName('mcp__my-server__read_file');

      expect(result).toEqual({
        serverName: 'my-server',
        toolName: 'read_file',
      });
    });

    it('should handle server names with underscores correctly', () => {
      const result = extractMCPToolName('mcp__my_server__read_file');

      expect(result).toEqual({
        serverName: 'my_server',
        toolName: 'read_file',
      });
    });

    it('should handle tool names with underscores', () => {
      const result = extractMCPToolName('mcp__fs__get_file_contents');

      expect(result).toEqual({
        serverName: 'fs',
        toolName: 'get_file_contents',
      });
    });

    it('should handle complex server names with underscores', () => {
      const result = extractMCPToolName('mcp__file_system_v2__write');

      expect(result).toEqual({
        serverName: 'file_system_v2',
        toolName: 'write',
      });
    });

    it('should return null for non-MCP tool names', () => {
      expect(extractMCPToolName('read_file')).toBeNull();
      expect(extractMCPToolName('execute_command')).toBeNull();
    });

    it('should return null for single underscore separator (old format)', () => {
      // Old format mcp_server_tool should NOT match the new mcp__server__tool pattern
      expect(extractMCPToolName('mcp_server_tool')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractMCPToolName('')).toBeNull();
    });

    it('should return null for mcp__ without tool portion', () => {
      expect(extractMCPToolName('mcp__server')).toBeNull();
    });
  });

  // ============================================
  // isMCPTool
  // ============================================

  describe('isMCPTool', () => {
    it('should return true for mcp__ prefixed names', () => {
      expect(isMCPTool('mcp__fs__read_file')).toBe(true);
      expect(isMCPTool('mcp__my-server__write')).toBe(true);
    });

    it('should return false for non-MCP names', () => {
      expect(isMCPTool('read_file')).toBe(false);
      expect(isMCPTool('execute_command')).toBe(false);
    });

    it('should return false for old single-underscore format', () => {
      expect(isMCPTool('mcp_fs_read')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isMCPTool('')).toBe(false);
    });
  });

  // ============================================
  // describeMCPToolParameters
  // ============================================

  describe('describeMCPToolParameters', () => {
    it('should describe tool parameters with types and descriptions', () => {
      const tool: MCPToolDefinition = {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
            encoding: { type: 'string', description: 'File encoding' },
          },
          required: ['path'],
        },
      };

      const result = describeMCPToolParameters(tool);

      expect(result).toContain('Parameters for read_file');
      expect(result).toContain('path');
      expect(result).toContain('(required)');
      expect(result).toContain('encoding');
      expect(result).toContain('(optional)');
      expect(result).toContain('string');
    });

    it('should handle tool with no properties', () => {
      const tool: MCPToolDefinition = {
        name: 'list',
        description: 'List items',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      };

      const result = describeMCPToolParameters(tool);
      expect(result).toContain('Parameters for list');
    });
  });
});
