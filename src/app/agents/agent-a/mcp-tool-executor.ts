import type { MCPToolCallResult } from '../../../infra/mcp/client/types.js';
import { getMCPConnectionManager } from '../../../infra/mcp/index.js';
import { assertAllowedTool } from './tool-allowlist.js';

export interface IMCPToolExecutor {
  callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult>;
}

export class MCPToolExecutor implements IMCPToolExecutor {
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    assertAllowedTool(serverName, toolName);
    const manager = getMCPConnectionManager();
    return manager.callTool(serverName, toolName, args as Record<string, any>);
  }
}

export function extractTextFromResult(result: MCPToolCallResult): string {
  const parts: string[] = [];
  for (const item of result.content) {
    if (item.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item.data !== undefined) {
      parts.push(JSON.stringify(item.data));
    }
  }
  return parts.join('\n');
}

export function parseJsonResult<T>(result: MCPToolCallResult): T {
  for (const item of result.content) {
    if (item.data && typeof item.data === 'object') {
      return item.data as T;
    }
  }

  const text = extractTextFromResult(result).trim();
  if (!text) {
    throw new Error('Empty MCP result payload');
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Failed to parse MCP JSON result: ${(error as Error).message}`);
  }
}
