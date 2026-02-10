/**
 * MCP Client Wrapper
 * Provides a unified interface for connecting to MCP servers via stdio or HTTP transport
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, ChildProcess } from 'child_process';
import type {
  MCPServerConfig,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
  MCPToolCallResult,
  MCPServerInfo,
  MCPConnectionState,
} from './types.js';
import { MCPConnectionError, MCPToolError } from './types.js';

export interface MCPClientOptions {
  serverName: string;
  config: MCPServerConfig;
  onStateChange?: (state: MCPConnectionState) => void;
  onToolsChanged?: () => void;
  onResourcesChanged?: () => void;
  onPromptsChanged?: () => void;
}

/**
 * MCP Client wrapper that handles connection lifecycle and operations
 */
export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private process: ChildProcess | null = null;
  private state: MCPConnectionState = 'disconnected';
  private serverInfo: MCPServerInfo | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelayMs = 5000;

  constructor(private options: MCPClientOptions) {}

  /**
   * Get current connection state
   */
  getState(): MCPConnectionState {
    return this.state;
  }

  /**
   * Get server info (available after connection)
   */
  getServerInfo(): MCPServerInfo | null {
    return this.serverInfo;
  }

  /**
   * Set connection state and notify listeners
   */
  private setState(state: MCPConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.options.onStateChange?.(state);
    }
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');

    try {
      if (this.options.config.transport === 'stdio') {
        await this.connectStdio();
      } else if (this.options.config.transport === 'http') {
        await this.connectHttp();
      } else {
        throw new MCPConnectionError(
          this.options.serverName,
          `Unsupported transport: ${this.options.config.transport}`
        );
      }

      // Initialize the connection
      await this.initialize();

      // Set up notification handlers
      this.setupNotificationHandlers();

      this.setState('connected');
      this.reconnectAttempts = 0;
    } catch (error) {
      this.setState('failed');
      throw new MCPConnectionError(
        this.options.serverName,
        `Failed to connect: ${(error as Error).message}`
      );
    }
  }

  /**
   * Connect using stdio transport
   */
  private async connectStdio(): Promise<void> {
    const { command, args = [], env = {} } = this.options.config;

    if (!command) {
      throw new MCPConnectionError(this.options.serverName, 'Missing command for stdio transport');
    }

    // Spawn the MCP server process
    this.process = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle process errors
    this.process.on('error', (error) => {
      console.error(`[MCPClient:${this.options.serverName}] Process error:`, error);
      this.handleDisconnection();
    });

    this.process.on('exit', (code, signal) => {
      console.warn(`[MCPClient:${this.options.serverName}] Process exited: code=${code}, signal=${signal}`);
      this.handleDisconnection();
    });

    // Pipe stderr for debugging
    this.process.stderr?.on('data', (data) => {
      console.error(`[MCPClient:${this.options.serverName}] stderr:`, data.toString());
    });

    // Create stdio transport
    this.transport = new StdioClientTransport({
      command,
      args,
      env,
    });

    // Create MCP client with list changed handlers
    this.client = new Client(
      {
        name: 'ponybunny',
        version: '1.0.0',
      },
      {
        capabilities: {
          sampling: {},
        },
        listChanged: {
          tools: {
            onChanged: (error) => {
              if (error) {
                console.error(`[MCPClient:${this.options.serverName}] Tools list changed error:`, error);
                return;
              }
              console.log(`[MCPClient:${this.options.serverName}] Tools list changed`);
              this.options.onToolsChanged?.();
            },
          },
          resources: {
            onChanged: (error) => {
              if (error) {
                console.error(`[MCPClient:${this.options.serverName}] Resources list changed error:`, error);
                return;
              }
              console.log(`[MCPClient:${this.options.serverName}] Resources list changed`);
              this.options.onResourcesChanged?.();
            },
          },
          prompts: {
            onChanged: (error) => {
              if (error) {
                console.error(`[MCPClient:${this.options.serverName}] Prompts list changed error:`, error);
                return;
              }
              console.log(`[MCPClient:${this.options.serverName}] Prompts list changed`);
              this.options.onPromptsChanged?.();
            },
          },
        },
      }
    );

    // Connect the client to the transport
    await this.client.connect(this.transport);
  }

  /**
   * Connect using HTTP transport
   */
  private async connectHttp(): Promise<void> {
    // TODO: Implement HTTP transport when SDK supports it
    throw new MCPConnectionError(
      this.options.serverName,
      'HTTP transport not yet implemented'
    );
  }

  /**
   * Initialize the MCP connection (capability negotiation)
   */
  private async initialize(): Promise<void> {
    if (!this.client) {
      throw new MCPConnectionError(this.options.serverName, 'Client not initialized');
    }

    try {
      // The SDK handles initialization automatically during connect()
      // We just need to get the server info after connection
      const serverVersion = this.client.getServerVersion();
      const serverCapabilities = this.client.getServerCapabilities();

      this.serverInfo = {
        name: serverVersion?.name || this.options.serverName,
        version: serverVersion?.version || 'unknown',
        protocolVersion: '2024-11-05',
        capabilities: serverCapabilities || {},
      };
    } catch (error) {
      throw new MCPConnectionError(
        this.options.serverName,
        `Initialization failed: ${(error as Error).message}`
      );
    }
  }

  /**
   * Set up notification handlers
   */
  private setupNotificationHandlers(): void {
    if (!this.client) return;

    // Note: The SDK handles list_changed notifications automatically
    // through the listChanged option in ClientOptions
    // We don't need to manually set up handlers here
  }

  /**
   * Handle disconnection and attempt reconnection if configured
   */
  private handleDisconnection(): void {
    if (this.state === 'disconnected') return;

    this.setState('disconnected');
    this.client = null;
    this.transport = null;
    this.process = null;

    // Attempt reconnection if enabled
    if (
      this.options.config.autoReconnect &&
      this.reconnectAttempts < this.maxReconnectAttempts
    ) {
      this.reconnectAttempts++;
      console.log(
        `[MCPClient:${this.options.serverName}] Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
      );

      this.setState('reconnecting');
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch((error) => {
          console.error(`[MCPClient:${this.options.serverName}] Reconnection failed:`, error);
        });
      }, this.reconnectDelayMs);
    } else {
      this.setState('failed');
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (!this.client || this.state !== 'connected') {
      throw new MCPConnectionError(this.options.serverName, 'Not connected');
    }

    try {
      const response = await this.client.listTools(undefined, {
        timeout: this.options.config.timeout || 30000,
      });

      return (response.tools || []) as MCPToolDefinition[];
    } catch (error) {
      throw new MCPConnectionError(
        this.options.serverName,
        `Failed to list tools: ${(error as Error).message}`
      );
    }
  }

  /**
   * Call a tool
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<MCPToolCallResult> {
    if (!this.client || this.state !== 'connected') {
      throw new MCPConnectionError(this.options.serverName, 'Not connected');
    }

    try {
      const response = await this.client.callTool(
        {
          name: toolName,
          arguments: args,
        },
        undefined,
        {
          timeout: this.options.config.timeout || 30000,
        }
      );

      return response as MCPToolCallResult;
    } catch (error) {
      throw new MCPToolError(
        this.options.serverName,
        toolName,
        (error as Error).message
      );
    }
  }

  /**
   * List available resources
   */
  async listResources(): Promise<MCPResourceDefinition[]> {
    if (!this.client || this.state !== 'connected') {
      throw new MCPConnectionError(this.options.serverName, 'Not connected');
    }

    try {
      const response = await this.client.listResources(undefined, {
        timeout: this.options.config.timeout || 30000,
      });

      return (response.resources || []) as MCPResourceDefinition[];
    } catch (error) {
      throw new MCPConnectionError(
        this.options.serverName,
        `Failed to list resources: ${(error as Error).message}`
      );
    }
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<any> {
    if (!this.client || this.state !== 'connected') {
      throw new MCPConnectionError(this.options.serverName, 'Not connected');
    }

    try {
      const response = await this.client.readResource(
        { uri },
        {
          timeout: this.options.config.timeout || 30000,
        }
      );

      return response;
    } catch (error) {
      throw new MCPConnectionError(
        this.options.serverName,
        `Failed to read resource: ${(error as Error).message}`
      );
    }
  }

  /**
   * List available prompts
   */
  async listPrompts(): Promise<MCPPromptDefinition[]> {
    if (!this.client || this.state !== 'connected') {
      throw new MCPConnectionError(this.options.serverName, 'Not connected');
    }

    try {
      const response = await this.client.listPrompts(undefined, {
        timeout: this.options.config.timeout || 30000,
      });

      return (response.prompts || []) as MCPPromptDefinition[];
    } catch (error) {
      throw new MCPConnectionError(
        this.options.serverName,
        `Failed to list prompts: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get a prompt
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<any> {
    if (!this.client || this.state !== 'connected') {
      throw new MCPConnectionError(this.options.serverName, 'Not connected');
    }

    try {
      const response = await this.client.getPrompt(
        { name, arguments: args },
        {
          timeout: this.options.config.timeout || 30000,
        }
      );

      return response;
    } catch (error) {
      throw new MCPConnectionError(
        this.options.serverName,
        `Failed to get prompt: ${(error as Error).message}`
      );
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close client
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.error(`[MCPClient:${this.options.serverName}] Error closing client:`, error);
      }
      this.client = null;
    }

    // Close transport
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        console.error(`[MCPClient:${this.options.serverName}] Error closing transport:`, error);
      }
      this.transport = null;
    }

    // Kill process
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.setState('disconnected');
    this.serverInfo = null;
  }

  /**
   * Check if tool is allowed by configuration
   */
  isToolAllowed(toolName: string): boolean {
    const allowedTools = this.options.config.allowedTools || ['*'];

    // If '*' is in the list, all tools are allowed
    if (allowedTools.includes('*')) {
      return true;
    }

    // Check if tool is explicitly allowed
    return allowedTools.includes(toolName);
  }
}
