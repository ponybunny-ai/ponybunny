/**
 * MCP Connection Manager
 * Manages connections to multiple MCP servers
 */

import { MCPClient, MCPClientOptions } from './mcp-client.js';
import type {
  MCPServerConfig,
  MCPConnectionState,
  MCPConnectionStatus,
  MCPToolDefinition,
} from './types.js';
import { MCPConnectionError } from './types.js';
import { loadMCPConfig, listEnabledMCPServers } from '../config/mcp-config-loader.js';

export interface ConnectionManagerOptions {
  onConnectionStateChange?: (serverName: string, state: MCPConnectionState) => void;
  onToolsChanged?: (serverName: string) => void;
  onResourcesChanged?: (serverName: string) => void;
  onPromptsChanged?: (serverName: string) => void;
}

/**
 * Manages multiple MCP client connections
 */
export class MCPConnectionManager {
  private clients = new Map<string, MCPClient>();
  private connectionStatus = new Map<string, MCPConnectionStatus>();

  constructor(private options: ConnectionManagerOptions = {}) {}

  /**
   * Initialize connections to all enabled MCP servers
   */
  async initialize(): Promise<void> {
    const config = loadMCPConfig();
    if (!config?.mcpServers) {
      console.log('[MCPConnectionManager] No MCP servers configured');
      return;
    }

    const enabledServers = listEnabledMCPServers();
    console.log(`[MCPConnectionManager] Initializing ${enabledServers.length} MCP servers...`);

    const connectionPromises = enabledServers.map(async (serverName) => {
      const serverConfig = config.mcpServers[serverName];
      if (!serverConfig) return;

      try {
        await this.connectServer(serverName, serverConfig);
        console.log(`[MCPConnectionManager] Connected to ${serverName}`);
      } catch (error) {
        console.error(`[MCPConnectionManager] Failed to connect to ${serverName}:`, error);
      }
    });

    await Promise.allSettled(connectionPromises);
  }

  /**
   * Connect to a specific MCP server
   */
  async connectServer(serverName: string, config: MCPServerConfig): Promise<void> {
    // Check if already connected
    if (this.clients.has(serverName)) {
      const client = this.clients.get(serverName)!;
      if (client.getState() === 'connected') {
        console.log(`[MCPConnectionManager] Already connected to ${serverName}`);
        return;
      }
    }

    // Create client options
    const clientOptions: MCPClientOptions = {
      serverName,
      config,
      onStateChange: (state) => {
        this.updateConnectionStatus(serverName, state);
        this.options.onConnectionStateChange?.(serverName, state);
      },
      onToolsChanged: () => {
        this.options.onToolsChanged?.(serverName);
      },
      onResourcesChanged: () => {
        this.options.onResourcesChanged?.(serverName);
      },
      onPromptsChanged: () => {
        this.options.onPromptsChanged?.(serverName);
      },
    };

    // Create and connect client
    const client = new MCPClient(clientOptions);
    this.clients.set(serverName, client);

    await client.connect();
  }

  /**
   * Disconnect from a specific MCP server
   */
  async disconnectServer(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) {
      return;
    }

    await client.disconnect();
    this.clients.delete(serverName);
    this.connectionStatus.delete(serverName);
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.clients.keys()).map((serverName) =>
      this.disconnectServer(serverName)
    );

    await Promise.allSettled(disconnectPromises);
  }

  /**
   * Get a specific MCP client
   */
  getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  /**
   * Get all connected clients
   */
  getAllClients(): Map<string, MCPClient> {
    return new Map(this.clients);
  }

  /**
   * Get connection status for a specific server
   */
  getConnectionStatus(serverName: string): MCPConnectionStatus | undefined {
    return this.connectionStatus.get(serverName);
  }

  /**
   * Get connection status for all servers
   */
  getAllConnectionStatus(): MCPConnectionStatus[] {
    return Array.from(this.connectionStatus.values());
  }

  /**
   * Update connection status
   */
  private updateConnectionStatus(serverName: string, state: MCPConnectionState): void {
    const client = this.clients.get(serverName);
    if (!client) return;

    const status: MCPConnectionStatus = {
      serverName,
      state,
      serverInfo: client.getServerInfo() || undefined,
      lastConnected: state === 'connected' ? new Date() : this.connectionStatus.get(serverName)?.lastConnected,
      lastError: state === 'failed' ? 'Connection failed' : undefined,
    };

    this.connectionStatus.set(serverName, status);
  }

  /**
   * List all tools from all connected servers
   */
  async listAllTools(): Promise<Map<string, MCPToolDefinition[]>> {
    const toolsMap = new Map<string, MCPToolDefinition[]>();

    const listPromises = Array.from(this.clients.entries()).map(async ([serverName, client]) => {
      if (client.getState() !== 'connected') {
        return;
      }

      try {
        const tools = await client.listTools();
        toolsMap.set(serverName, tools);
      } catch (error) {
        console.error(`[MCPConnectionManager] Failed to list tools from ${serverName}:`, error);
      }
    });

    await Promise.allSettled(listPromises);
    return toolsMap;
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, any>
  ): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new MCPConnectionError(serverName, 'Server not connected');
    }

    if (client.getState() !== 'connected') {
      throw new MCPConnectionError(serverName, 'Server not in connected state');
    }

    // Check if tool is allowed
    if (!client.isToolAllowed(toolName)) {
      throw new MCPConnectionError(
        serverName,
        `Tool '${toolName}' is not in the allowed tools list`
      );
    }

    return await client.callTool(toolName, args);
  }

  /**
   * Reconnect to a specific server
   */
  async reconnectServer(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new MCPConnectionError(serverName, 'Server not found');
    }

    await client.disconnect();
    await client.connect();
  }

  /**
   * Check if a server is connected
   */
  isServerConnected(serverName: string): boolean {
    const client = this.clients.get(serverName);
    return client?.getState() === 'connected';
  }

  /**
   * Get list of connected server names
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.entries())
      .filter(([_, client]) => client.getState() === 'connected')
      .map(([name]) => name);
  }

  /**
   * Reload configuration and reconnect servers
   */
  async reloadConfiguration(): Promise<void> {
    console.log('[MCPConnectionManager] Reloading configuration...');

    // Disconnect all current connections
    await this.disconnectAll();

    // Reinitialize with new configuration
    await this.initialize();
  }
}

// Singleton instance
let globalConnectionManager: MCPConnectionManager | null = null;

/**
 * Get the global MCP connection manager instance
 */
export function getMCPConnectionManager(): MCPConnectionManager {
  if (!globalConnectionManager) {
    globalConnectionManager = new MCPConnectionManager();
  }
  return globalConnectionManager;
}

/**
 * Initialize the global MCP connection manager
 */
export async function initializeMCPConnectionManager(
  options?: ConnectionManagerOptions
): Promise<MCPConnectionManager> {
  if (globalConnectionManager) {
    await globalConnectionManager.disconnectAll();
  }

  globalConnectionManager = new MCPConnectionManager(options);
  await globalConnectionManager.initialize();

  return globalConnectionManager;
}

/**
 * Shutdown the global MCP connection manager
 */
export async function shutdownMCPConnectionManager(): Promise<void> {
  if (globalConnectionManager) {
    await globalConnectionManager.disconnectAll();
    globalConnectionManager = null;
  }
}
