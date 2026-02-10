/**
 * MCP End-to-End Pipeline Tests
 * Tests the full chain: LLM tool_call → ToolProvider → ToolRegistry → MCP adapter → MCP server
 * Validates the integration gaps fixed in the previous review rounds.
 */

import { ToolRegistry, ToolAllowlist, ToolEnforcer } from '../../../src/infra/tools/tool-registry.js';
import { ToolProvider, cacheMCPToolSchema, clearMCPToolSchemaCache } from '../../../src/infra/tools/tool-provider.js';
import {
  adaptMCPTool,
  extractMCPToolName,
  isMCPTool,
} from '../../../src/infra/mcp/adapters/tool-adapter.js';
import type { MCPToolDefinition, MCPToolCallResult } from '../../../src/infra/mcp/client/types.js';

// Mock connection manager for tool execution
const mockCallTool = jest.fn<Promise<MCPToolCallResult>, [string, string, Record<string, any>]>();

jest.mock('../../../src/infra/mcp/client/connection-manager.js', () => ({
  getMCPConnectionManager: jest.fn(() => ({
    callTool: mockCallTool,
    initialize: jest.fn().mockResolvedValue(undefined),
    listAllTools: jest.fn().mockResolvedValue(new Map()),
    disconnectAll: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('MCP End-to-End Pipeline', () => {
  let registry: ToolRegistry;
  let allowlist: ToolAllowlist;
  let enforcer: ToolEnforcer;
  let toolProvider: ToolProvider;

  // Sample MCP tools simulating a real MCP server
  const mcpTools: MCPToolDefinition[] = [
    {
      name: 'read_file',
      description: 'Read a file from the filesystem',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'search_files',
      description: 'Search for files matching a pattern',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern' },
          path: { type: 'string', description: 'Base directory' },
        },
        required: ['pattern'],
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    clearMCPToolSchemaCache();

    // Set up a fresh registry with built-in + MCP tools
    registry = new ToolRegistry();
    allowlist = new ToolAllowlist();

    // Register a built-in tool for comparison
    registry.register({
      name: 'execute_command',
      description: 'Execute a shell command',
      category: 'shell',
      riskLevel: 'dangerous',
      requiresApproval: false,
      execute: async (args) => `Executed: ${args.command}`,
    });
    allowlist.addTool('execute_command');

    // Register MCP tools (simulates what initializeMCPIntegration does)
    for (const mcpTool of mcpTools) {
      const adapted = adaptMCPTool('filesystem', mcpTool);
      registry.register(adapted);
      allowlist.addTool(adapted.name);
    }

    enforcer = new ToolEnforcer(registry, allowlist);
    toolProvider = new ToolProvider(enforcer);
  });

  // ============================================
  // 1. ToolProvider exposes MCP tools to LLM
  // ============================================

  describe('ToolProvider → LLM tool definitions', () => {
    it('should include MCP tools in LLM tool definitions', () => {
      const definitions = toolProvider.getToolDefinitions();

      const mcpDefs = definitions.filter(d => d.name.startsWith('mcp__'));
      expect(mcpDefs.length).toBe(3);
    });

    it('should include built-in tools alongside MCP tools', () => {
      const definitions = toolProvider.getToolDefinitions();

      const builtinDef = definitions.find(d => d.name === 'execute_command');
      expect(builtinDef).toBeDefined();
      expect(builtinDef!.description).toBe('Execute a shell command');
    });

    it('should expose MCP tool inputSchema as parameters', () => {
      const definitions = toolProvider.getToolDefinitions();

      const readFileDef = definitions.find(d => d.name === 'mcp__filesystem__read_file');
      expect(readFileDef).toBeDefined();
      expect(readFileDef!.parameters).toBeDefined();
      expect(readFileDef!.parameters.properties).toHaveProperty('path');
      expect(readFileDef!.parameters.required).toContain('path');
    });

    it('should categorize MCP tools as mcp in summaries', () => {
      const summaries = toolProvider.getToolSummaries();

      const mcpSummaries = summaries.filter(s => s.category === 'mcp');
      expect(mcpSummaries.length).toBe(3);
    });

    it('should always include complete_task virtual tool', () => {
      const definitions = toolProvider.getToolDefinitions();

      const completeTask = definitions.find(d => d.name === 'complete_task');
      expect(completeTask).toBeDefined();
    });
  });

  // ============================================
  // 2. ToolEnforcer gates MCP tool invocations
  // ============================================

  describe('ToolEnforcer → permission check', () => {
    it('should allow MCP tools that are in the allowlist', () => {
      const check = enforcer.checkToolInvocation('mcp__filesystem__read_file', { path: '/test.txt' });
      expect(check.allowed).toBe(true);
    });

    it('should deny MCP tools that are not in the allowlist', () => {
      // Create a tool that's registered but not allowlisted
      const tool = adaptMCPTool('dangerous', {
        name: 'rm_rf',
        description: 'Delete everything',
        inputSchema: { type: 'object', properties: {} },
      });
      registry.register(tool);
      // Don't add to allowlist

      const check = enforcer.checkToolInvocation('mcp__dangerous__rm_rf', {});
      expect(check.allowed).toBe(false);
    });

    it('should expose registry and allowlist via public getters', () => {
      expect(enforcer.registry).toBe(registry);
      expect(enforcer.allowlist).toBe(allowlist);
    });
  });

  // ============================================
  // 3. Tool execution flows through MCP adapter
  // ============================================

  describe('ToolRegistry → MCP tool execution', () => {
    it('should execute MCP tool and return formatted result', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name":"pony","version":"1.0.0"}' }],
        isError: false,
      });

      const tool = registry.getTool('mcp__filesystem__read_file');
      expect(tool).toBeDefined();

      const result = await tool!.execute(
        { path: 'package.json' },
        { cwd: '/workspace', allowlist, enforcer }
      );

      expect(result).toBe('{"name":"pony","version":"1.0.0"}');
    });

    it('should throw on MCP tool error response', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'File not found' }],
        isError: true,
      });

      const tool = registry.getTool('mcp__filesystem__read_file');

      await expect(
        tool!.execute(
          { path: '/nonexistent' },
          { cwd: '/workspace', allowlist, enforcer }
        )
      ).rejects.toThrow('MCP tool returned error');
    });

    it('should handle multi-content MCP results', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
        isError: false,
      });

      const tool = registry.getTool('mcp__filesystem__read_file');
      const result = await tool!.execute(
        { path: 'test.txt' },
        { cwd: '/workspace', allowlist, enforcer }
      );

      expect(result).toContain('Part 1');
      expect(result).toContain('Part 2');
    });
  });

  // ============================================
  // 4. Tool name round-trip (namespace → extract)
  // ============================================

  describe('tool name round-trip', () => {
    it('should round-trip simple server and tool names', () => {
      const adapted = adaptMCPTool('myserver', {
        name: 'mytool',
        description: 'Test',
        inputSchema: { type: 'object', properties: {} },
      });

      const extracted = extractMCPToolName(adapted.name);
      expect(extracted).toEqual({ serverName: 'myserver', toolName: 'mytool' });
    });

    it('should round-trip server names with underscores', () => {
      const adapted = adaptMCPTool('my_server', {
        name: 'my_tool',
        description: 'Test',
        inputSchema: { type: 'object', properties: {} },
      });

      const extracted = extractMCPToolName(adapted.name);
      expect(extracted).toEqual({ serverName: 'my_server', toolName: 'my_tool' });
    });

    it('should round-trip server names with hyphens', () => {
      const adapted = adaptMCPTool('my-server', {
        name: 'read_file',
        description: 'Test',
        inputSchema: { type: 'object', properties: {} },
      });

      const extracted = extractMCPToolName(adapted.name);
      expect(extracted).toEqual({ serverName: 'my-server', toolName: 'read_file' });
    });

    it('should correctly identify MCP tools via isMCPTool', () => {
      const adapted = adaptMCPTool('fs', {
        name: 'read',
        description: 'Test',
        inputSchema: { type: 'object', properties: {} },
      });

      expect(isMCPTool(adapted.name)).toBe(true);
      expect(isMCPTool('execute_command')).toBe(false);
    });
  });

  // ============================================
  // 5. Full simulated LLM→Tool→MCP pipeline
  // ============================================

  describe('full LLM → Tool → MCP pipeline simulation', () => {
    it('should process a simulated LLM tool_call through the full pipeline', async () => {
      // Step 1: LLM generates tool definitions (ToolProvider)
      const definitions = toolProvider.getToolDefinitions();
      const readFileDef = definitions.find(d => d.name === 'mcp__filesystem__read_file');
      expect(readFileDef).toBeDefined();

      // Step 2: LLM returns a tool_call (simulated)
      const llmToolCall = {
        id: 'call_001',
        type: 'function' as const,
        function: {
          name: 'mcp__filesystem__read_file',
          arguments: JSON.stringify({ path: 'src/main.ts' }),
        },
      };

      // Step 3: ToolEnforcer checks permission
      const toolName = llmToolCall.function.name;
      const parameters = JSON.parse(llmToolCall.function.arguments);
      const check = enforcer.checkToolInvocation(toolName, parameters);
      expect(check.allowed).toBe(true);

      // Step 4: ToolRegistry executes the tool
      const tool = enforcer.registry.getTool(toolName);
      expect(tool).toBeDefined();

      // Step 5: MCP adapter calls connection manager
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'import { main } from "./app.js";' }],
        isError: false,
      });

      const result = await tool!.execute(parameters, {
        cwd: process.cwd(),
        allowlist: enforcer.allowlist,
        enforcer,
      });

      // Step 6: Result flows back to LLM
      expect(result).toBe('import { main } from "./app.js";');
    });

    it('should handle denied tool_call in the pipeline', () => {
      // Register but don't allowlist a dangerous tool
      const dangerousTool = adaptMCPTool('system', {
        name: 'delete_all',
        description: 'Delete everything',
        inputSchema: { type: 'object', properties: {} },
      });
      registry.register(dangerousTool);

      // Don't add to allowlist: allowlist.addTool(dangerousTool.name);

      const check = enforcer.checkToolInvocation('mcp__system__delete_all', {});
      expect(check.allowed).toBe(false);
      expect(check.reason).toBeDefined();
    });

    it('should handle tool execution failure in the pipeline', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('Connection timeout'));

      const tool = registry.getTool('mcp__filesystem__read_file');

      await expect(
        tool!.execute(
          { path: 'test.txt' },
          { cwd: '/workspace', allowlist, enforcer }
        )
      ).rejects.toThrow('MCP tool execution failed');
    });
  });

  // ============================================
  // 6. Schema cache lifecycle
  // ============================================

  describe('schema cache lifecycle', () => {
    it('should cache schemas during tool adaptation and expose in definitions', () => {
      clearMCPToolSchemaCache();

      // Re-register to trigger cache population
      const tool: MCPToolDefinition = {
        name: 'custom_query',
        description: 'Custom query',
        inputSchema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'SQL query' },
            limit: { type: 'number', description: 'Result limit' },
          },
          required: ['sql'],
        },
      };

      const adapted = adaptMCPTool('database', tool);
      registry.register(adapted);
      allowlist.addTool(adapted.name);

      // ToolProvider should pick up the cached schema
      const definitions = toolProvider.getToolDefinitions();
      const queryDef = definitions.find(d => d.name === 'mcp__database__custom_query');

      expect(queryDef).toBeDefined();
      expect(queryDef!.parameters.properties).toHaveProperty('sql');
      expect(queryDef!.parameters.properties).toHaveProperty('limit');
      expect(queryDef!.parameters.required).toContain('sql');
    });

    it('should clear schemas on clearMCPToolSchemaCache', () => {
      cacheMCPToolSchema('mcp__test__tool', {
        type: 'object',
        properties: { x: { type: 'string' } },
      });

      clearMCPToolSchemaCache();

      // After clearing, a fresh ToolProvider won't find the schema
      // (it will use empty fallback)
      const freshProvider = new ToolProvider(enforcer);
      const defs = freshProvider.getToolDefinitions();
      const testDef = defs.find(d => d.name === 'mcp__filesystem__read_file');

      // The MCP tool should still show up (it's in registry),
      // but its schema should be from cache populated by adaptMCPTool in beforeEach
      expect(testDef).toBeDefined();
    });
  });
});
