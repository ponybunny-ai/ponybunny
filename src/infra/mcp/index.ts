/**
 * MCP Public API
 * Main entry point for MCP integration
 */

// Client
export { MCPClient } from './client/mcp-client.js';
export {
  MCPConnectionManager,
  getMCPConnectionManager,
  initializeMCPConnectionManager,
  shutdownMCPConnectionManager,
} from './client/connection-manager.js';

// Types
export type {
  MCPTransport,
  MCPServerConfig,
  MCPConfig,
  MCPToolDefinition,
  MCPResourceDefinition,
  MCPPromptDefinition,
  MCPToolCallResult,
  MCPServerCapabilities,
  MCPServerInfo,
  MCPConnectionState,
  MCPConnectionStatus,
} from './client/types.js';

export {
  MCPError,
  MCPConnectionError,
  MCPToolError,
  MCPConfigError,
} from './client/types.js';

// Configuration
export {
  loadMCPConfig,
  getMCPServerConfig,
  saveMCPConfig,
  setMCPServerConfig,
  removeMCPServerConfig,
  listMCPServers,
  listEnabledMCPServers,
  mcpConfigFileExists,
  getCachedMCPConfig,
  clearMCPConfigCache,
  getMCPConfigPath,
  getMCPConfigSchemaPath,
} from './config/mcp-config-loader.js';

// Adapters
export {
  adaptMCPTool,
  adaptMCPTools,
  extractMCPToolName,
  isMCPTool,
  describeMCPToolParameters,
} from './adapters/tool-adapter.js';

// Registry Integration
export {
  registerMCPTools,
  refreshMCPTools,
  initializeMCPIntegration,
} from './adapters/registry-integration.js';
