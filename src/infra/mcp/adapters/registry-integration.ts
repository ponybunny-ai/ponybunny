/**
 * MCP Tool Registry Integration
 * Registers MCP tools into the PonyBunny ToolRegistry
 */

import { ToolRegistry } from '../../tools/tool-registry.js';
import { getMCPConnectionManager } from '../client/connection-manager.js';
import { adaptMCPTools } from '../adapters/tool-adapter.js';
import { clearMCPToolSchemaCache } from '../../tools/tool-provider.js';
import type { ILogger } from '../../observability/logger.js';
import { NoopLogger } from '../../observability/logger.js';

/**
 * Register all tools from all connected MCP servers into the ToolRegistry
 */
export async function registerMCPTools(registry: ToolRegistry, logger?: ILogger): Promise<void> {
  const log = (logger ?? new NoopLogger()).child({ component: 'MCPRegistryIntegration' });
  const connectionManager = getMCPConnectionManager();

  // Get all tools from all connected servers
  const toolsMap = await connectionManager.listAllTools();

  let totalRegistered = 0;

  for (const [serverName, mcpTools] of toolsMap.entries()) {
    log.debug({ server: serverName, count: mcpTools.length }, 'Registering tools from server');

    // Convert MCP tools to PonyBunny ToolDefinitions
    const adaptedTools = adaptMCPTools(serverName, mcpTools);

    // Register each tool
    for (const tool of adaptedTools) {
      registry.register(tool);
      totalRegistered++;
    }
  }

  log.debug({ totalRegistered, serverCount: toolsMap.size }, 'Registered MCP tools');
}

/**
 * Refresh MCP tools in the registry (useful after tool list changes)
 */
export async function refreshMCPTools(registry: ToolRegistry, logger?: ILogger): Promise<void> {
  const log = (logger ?? new NoopLogger()).child({ component: 'MCPRegistryIntegration' });
  log.debug({}, 'Refreshing MCP tools');

  // Clear cached MCP tool schemas
  clearMCPToolSchemaCache();

  // Remove all existing MCP tools
  const allTools = registry.getAllTools();
  let removedCount = 0;
  for (const tool of allTools) {
    if (tool.name.startsWith('mcp__')) {
      registry.unregister(tool.name);
      removedCount++;
    }
  }

  log.debug({ removedCount }, 'Removed existing MCP tools');

  // Re-register all MCP tools
  await registerMCPTools(registry, logger);
}

/**
 * Initialize MCP integration and register tools
 */
export async function initializeMCPIntegration(registry: ToolRegistry, logger?: ILogger): Promise<void> {
  const log = (logger ?? new NoopLogger()).child({ component: 'MCPRegistryIntegration' });
  log.debug({}, 'Initializing MCP integration');

  const connectionManager = getMCPConnectionManager();

  // Set up event handlers for tool changes
  await connectionManager.initialize();

  // Register initial tools
  await registerMCPTools(registry, logger);

  log.debug({}, 'MCP integration initialized');
}
