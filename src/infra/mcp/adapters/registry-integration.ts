/**
 * MCP Tool Registry Integration
 * Registers MCP tools into the PonyBunny ToolRegistry
 */

import { ToolRegistry } from '../../tools/tool-registry.js';
import { getMCPConnectionManager } from '../client/connection-manager.js';
import { adaptMCPTools } from '../adapters/tool-adapter.js';
import { clearMCPToolSchemaCache } from '../../tools/tool-provider.js';

/**
 * Register all tools from all connected MCP servers into the ToolRegistry
 */
export async function registerMCPTools(registry: ToolRegistry): Promise<void> {
  const connectionManager = getMCPConnectionManager();

  // Get all tools from all connected servers
  const toolsMap = await connectionManager.listAllTools();

  let totalRegistered = 0;

  for (const [serverName, mcpTools] of toolsMap.entries()) {
    console.log(`[MCP] Registering ${mcpTools.length} tools from ${serverName}...`);

    // Convert MCP tools to PonyBunny ToolDefinitions
    const adaptedTools = adaptMCPTools(serverName, mcpTools);

    // Register each tool
    for (const tool of adaptedTools) {
      registry.register(tool);
      totalRegistered++;
    }
  }

  console.log(`[MCP] Registered ${totalRegistered} tools from ${toolsMap.size} servers`);
}

/**
 * Refresh MCP tools in the registry (useful after tool list changes)
 */
export async function refreshMCPTools(registry: ToolRegistry): Promise<void> {
  console.log('[MCP] Refreshing MCP tools...');

  // Clear cached MCP tool schemas
  clearMCPToolSchemaCache();

  // Remove all existing MCP tools
  const allTools = registry.getAllTools();
  let removedCount = 0;
  for (const tool of allTools) {
    if (tool.name.startsWith('mcp_')) {
      registry.unregister(tool.name);
      removedCount++;
    }
  }

  console.log(`[MCP] Removed ${removedCount} existing MCP tools`);

  // Re-register all MCP tools
  await registerMCPTools(registry);
}

/**
 * Initialize MCP integration and register tools
 */
export async function initializeMCPIntegration(registry: ToolRegistry): Promise<void> {
  console.log('[MCP] Initializing MCP integration...');

  const connectionManager = getMCPConnectionManager();

  // Set up event handlers for tool changes
  await connectionManager.initialize();

  // Register initial tools
  await registerMCPTools(registry);

  console.log('[MCP] MCP integration initialized');
}
