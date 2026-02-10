/**
 * MCP Tool Adapter
 * Converts MCP tools to PonyBunny ToolDefinition format
 */

import type { ToolDefinition, ToolContext } from '../../tools/tool-registry.js';
import type { MCPToolDefinition, MCPToolCallResult } from '../client/types.js';
import { getMCPConnectionManager } from '../client/connection-manager.js';
import { cacheMCPToolSchema } from '../../tools/tool-provider.js';

/**
 * Convert MCP tool to PonyBunny ToolDefinition
 */
export function adaptMCPTool(
  serverName: string,
  mcpTool: MCPToolDefinition
): ToolDefinition {
  // Create namespaced tool name: mcp_<server>_<tool>
  const toolName = `mcp_${serverName}_${mcpTool.name}`;

  // Cache the MCP tool's inputSchema so ToolProvider can expose it to the LLM
  cacheMCPToolSchema(toolName, mcpTool.inputSchema);

  return {
    name: toolName,
    category: 'network', // MCP tools are external network calls
    riskLevel: 'moderate', // External tools are moderate risk
    requiresApproval: false, // Can be overridden by allowlist
    description: `[MCP:${serverName}] ${mcpTool.description}`,

    async execute(args: Record<string, any>, context: ToolContext): Promise<string> {
      const connectionManager = getMCPConnectionManager();

      try {
        // Call the MCP tool
        const result: MCPToolCallResult = await connectionManager.callTool(
          serverName,
          mcpTool.name,
          args
        );

        // Convert MCP result to string
        return formatMCPResult(result);
      } catch (error) {
        throw new Error(`MCP tool execution failed: ${(error as Error).message}`);
      }
    },
  };
}

/**
 * Format MCP tool call result as string
 */
function formatMCPResult(result: MCPToolCallResult): string {
  if (result.isError) {
    throw new Error(`MCP tool returned error: ${JSON.stringify(result.content)}`);
  }

  // Combine all content items
  const parts: string[] = [];

  for (const item of result.content) {
    if (item.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item.type === 'resource' && item.data) {
      // Handle resource content
      parts.push(JSON.stringify(item.data, null, 2));
    } else if (item.data) {
      // Handle other data types
      parts.push(JSON.stringify(item.data, null, 2));
    }
  }

  return parts.join('\n\n');
}

/**
 * Batch convert multiple MCP tools
 */
export function adaptMCPTools(
  serverName: string,
  mcpTools: MCPToolDefinition[]
): ToolDefinition[] {
  return mcpTools.map((tool) => adaptMCPTool(serverName, tool));
}

/**
 * Extract original MCP tool name from namespaced name
 */
export function extractMCPToolName(namespacedName: string): {
  serverName: string;
  toolName: string;
} | null {
  const match = namespacedName.match(/^mcp_([^_]+)_(.+)$/);
  if (!match) {
    return null;
  }

  return {
    serverName: match[1],
    toolName: match[2],
  };
}

/**
 * Check if a tool name is an MCP tool
 */
export function isMCPTool(toolName: string): boolean {
  return toolName.startsWith('mcp_');
}

/**
 * Convert MCP input schema to PonyBunny parameter description
 */
export function describeMCPToolParameters(mcpTool: MCPToolDefinition): string {
  const schema = mcpTool.inputSchema;
  const parts: string[] = [];

  parts.push(`Parameters for ${mcpTool.name}:`);

  if (schema.properties) {
    for (const [paramName, paramSchema] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(paramName) ? ' (required)' : ' (optional)';
      const description = (paramSchema as any).description || 'No description';
      const type = (paramSchema as any).type || 'unknown';

      parts.push(`  - ${paramName}${required}: ${type} - ${description}`);
    }
  }

  return parts.join('\n');
}
