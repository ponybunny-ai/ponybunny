/**
 * MCP Configuration Types
 */

export type MCPTransport = 'stdio' | 'http';

export interface MCPServerConfig {
  enabled?: boolean;
  transport: MCPTransport;

  // Stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // HTTP transport
  url?: string;
  headers?: Record<string, string>;

  // Common
  allowedTools?: string[];
  autoReconnect?: boolean;
  timeout?: number;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * MCP Client Types
 */

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface MCPResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    data?: any;
  }>;
  isError?: boolean;
}

export interface MCPServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: {};
}

export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: MCPServerCapabilities;
}

/**
 * Connection State
 */

export type MCPConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface MCPConnectionStatus {
  serverName: string;
  state: MCPConnectionState;
  serverInfo?: MCPServerInfo;
  lastConnected?: Date;
  lastError?: string;
  reconnectAttempts?: number;
}

/**
 * Errors
 */

export class MCPError extends Error {
  constructor(
    message: string,
    public readonly serverName: string,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

export class MCPConnectionError extends MCPError {
  constructor(serverName: string, message: string) {
    super(message, serverName, true);
    this.name = 'MCPConnectionError';
  }
}

export class MCPToolError extends MCPError {
  constructor(serverName: string, toolName: string, message: string) {
    super(`Tool '${toolName}' failed: ${message}`, serverName, false);
    this.name = 'MCPToolError';
  }
}

export class MCPConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MCPConfigError';
  }
}
