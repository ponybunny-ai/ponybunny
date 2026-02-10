/**
 * MCP Client Tests
 * Tests connection lifecycle, tool operations, state management, and error handling
 */

import { MCPClient } from '../../../../src/infra/mcp/client/mcp-client.js';
import { MCPConnectionError, MCPToolError } from '../../../../src/infra/mcp/client/types.js';
import type { MCPServerConfig } from '../../../../src/infra/mcp/client/types.js';

// Mock the MCP SDK modules
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockClose = jest.fn().mockResolvedValue(undefined);
const mockListTools = jest.fn().mockResolvedValue({ tools: [] });
const mockCallTool = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] });
const mockListResources = jest.fn().mockResolvedValue({ resources: [] });
const mockListPrompts = jest.fn().mockResolvedValue({ prompts: [] });
const mockGetServerVersion = jest.fn().mockReturnValue({ name: 'test-server', version: '1.0.0' });
const mockGetServerCapabilities = jest.fn().mockReturnValue({ tools: { listChanged: true } });

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
    listResources: mockListResources,
    listPrompts: mockListPrompts,
    getServerVersion: mockGetServerVersion,
    getServerCapabilities: mockGetServerCapabilities,
    readResource: jest.fn().mockResolvedValue({ contents: [] }),
    getPrompt: jest.fn().mockResolvedValue({ messages: [] }),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
    onclose: null,
    onerror: null,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
    onclose: null,
    onerror: null,
  })),
}));

// Mock child_process.spawn
jest.mock('child_process', () => ({
  spawn: jest.fn().mockReturnValue({
    on: jest.fn(),
    stderr: { on: jest.fn() },
    kill: jest.fn(),
    stdin: {},
    stdout: {},
  }),
}));

describe('MCPClient', () => {
  const createStdioConfig = (overrides: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/workspace'],
    allowedTools: ['*'],
    timeout: 30000,
    ...overrides,
  });

  const createHttpConfig = (overrides: Partial<MCPServerConfig> = {}): MCPServerConfig => ({
    transport: 'http',
    url: 'http://localhost:3000/mcp',
    headers: { Authorization: 'Bearer token' },
    allowedTools: ['*'],
    timeout: 30000,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // Connection Lifecycle
  // ============================================

  describe('connection lifecycle', () => {
    it('should start in disconnected state', () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      expect(client.getState()).toBe('disconnected');
      expect(client.getServerInfo()).toBeNull();
    });

    it('should connect via stdio transport', async () => {
      const client = new MCPClient({
        serverName: 'test-stdio',
        config: createStdioConfig(),
      });

      await client.connect();

      expect(client.getState()).toBe('connected');
      expect(client.getServerInfo()).toBeDefined();
      expect(client.getServerInfo()!.name).toBe('test-server');
    });

    it('should connect via http transport', async () => {
      const client = new MCPClient({
        serverName: 'test-http',
        config: createHttpConfig(),
      });

      await client.connect();

      expect(client.getState()).toBe('connected');
    });

    it('should disconnect cleanly', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      await client.disconnect();

      expect(client.getState()).toBe('disconnected');
      expect(client.getServerInfo()).toBeNull();
    });

    it('should not reconnect after intentional disconnect', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig({ autoReconnect: true }),
      });

      await client.connect();
      await client.disconnect();

      expect(client.getState()).toBe('disconnected');
    });

    it('should be idempotent when already connected', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      await client.connect(); // Should not throw or create second connection

      expect(client.getState()).toBe('connected');
    });

    it('should throw MCPConnectionError for unsupported transport', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: { transport: 'grpc' as any },
      });

      await expect(client.connect()).rejects.toThrow(MCPConnectionError);
    });

    it('should throw MCPConnectionError when stdio command is missing', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: { transport: 'stdio' }, // no command
      });

      await expect(client.connect()).rejects.toThrow(MCPConnectionError);
    });

    it('should throw MCPConnectionError when http url is missing', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: { transport: 'http' }, // no url
      });

      await expect(client.connect()).rejects.toThrow(MCPConnectionError);
    });

    it('should notify state change callback', async () => {
      const stateChanges: string[] = [];
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
        onStateChange: (state) => stateChanges.push(state),
      });

      await client.connect();
      await client.disconnect();

      expect(stateChanges).toContain('connecting');
      expect(stateChanges).toContain('connected');
      expect(stateChanges).toContain('disconnected');
    });
  });

  // ============================================
  // Tool Operations
  // ============================================

  describe('tool operations', () => {
    it('should list tools when connected', async () => {
      mockListTools.mockResolvedValueOnce({
        tools: [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } },
          { name: 'write_file', description: 'Write a file', inputSchema: { type: 'object', properties: {} } },
        ],
      });

      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      const tools = await client.listTools();

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('read_file');
      expect(tools[1].name).toBe('write_file');
    });

    it('should throw when listing tools while disconnected', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await expect(client.listTools()).rejects.toThrow(MCPConnectionError);
    });

    it('should call a tool successfully', async () => {
      mockCallTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"name":"pony"}' }],
        isError: false,
      });

      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      const result = await client.callTool('read_file', { path: 'package.json' });

      expect(result.content[0].text).toBe('{"name":"pony"}');
      expect(result.isError).toBe(false);
    });

    it('should throw MCPToolError when tool call fails', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('Tool not found'));

      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      await expect(client.callTool('nonexistent', {})).rejects.toThrow(MCPToolError);
    });

    it('should throw when calling tool while disconnected', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await expect(client.callTool('read_file', {})).rejects.toThrow(MCPConnectionError);
    });
  });

  // ============================================
  // Resource Operations
  // ============================================

  describe('resource operations', () => {
    it('should list resources when connected', async () => {
      mockListResources.mockResolvedValueOnce({
        resources: [
          { uri: 'file:///workspace/README.md', name: 'README', mimeType: 'text/markdown' },
        ],
      });

      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      const resources = await client.listResources();

      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('file:///workspace/README.md');
    });

    it('should throw when listing resources while disconnected', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await expect(client.listResources()).rejects.toThrow(MCPConnectionError);
    });
  });

  // ============================================
  // Tool Allowlist
  // ============================================

  describe('isToolAllowed', () => {
    it('should allow all tools when wildcard is set', () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig({ allowedTools: ['*'] }),
      });

      expect(client.isToolAllowed('read_file')).toBe(true);
      expect(client.isToolAllowed('write_file')).toBe(true);
      expect(client.isToolAllowed('anything')).toBe(true);
    });

    it('should only allow listed tools when specific tools are set', () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig({ allowedTools: ['read_file', 'list_dir'] }),
      });

      expect(client.isToolAllowed('read_file')).toBe(true);
      expect(client.isToolAllowed('list_dir')).toBe(true);
      expect(client.isToolAllowed('write_file')).toBe(false);
      expect(client.isToolAllowed('execute_command')).toBe(false);
    });

    it('should default to wildcard when allowedTools is not set', () => {
      const client = new MCPClient({
        serverName: 'test',
        config: { transport: 'stdio', command: 'echo' },
      });

      expect(client.isToolAllowed('anything')).toBe(true);
    });
  });

  // ============================================
  // Server Info
  // ============================================

  describe('server info', () => {
    it('should populate server info after connection', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      const info = client.getServerInfo();

      expect(info).toBeDefined();
      expect(info!.name).toBe('test-server');
      expect(info!.version).toBe('1.0.0');
      expect(info!.capabilities).toBeDefined();
    });

    it('should return null before connection', () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      expect(client.getServerInfo()).toBeNull();
    });

    it('should clear server info after disconnect', async () => {
      const client = new MCPClient({
        serverName: 'test',
        config: createStdioConfig(),
      });

      await client.connect();
      expect(client.getServerInfo()).not.toBeNull();

      await client.disconnect();
      expect(client.getServerInfo()).toBeNull();
    });
  });
});
