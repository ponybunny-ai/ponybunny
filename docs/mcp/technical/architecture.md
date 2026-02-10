# MCP Integration Design

## Overview

This document outlines the integration of Model Context Protocol (MCP) into PonyBunny, enabling the system to connect to external MCP servers and expose their tools, resources, and prompts to the autonomous agent.

## Goals

1. **Seamless Integration**: MCP tools should work alongside existing PonyBunny tools
2. **Configuration-Driven**: MCP servers configured via `~/.ponybunny/mcp-config.json`
3. **Dynamic Discovery**: Automatically discover and register tools from MCP servers
4. **Lifecycle Management**: Handle MCP server connections, reconnections, and failures
5. **Security**: Respect tool allowlists and enforce security policies

## Architecture

### Components

```
src/infra/mcp/
├── client/
│   ├── mcp-client.ts           # MCP client wrapper (stdio/HTTP transport)
│   ├── connection-manager.ts   # Manages multiple MCP server connections
│   └── types.ts                # MCP-specific types
├── adapters/
│   ├── tool-adapter.ts         # Converts MCP tools to PonyBunny ToolDefinition
│   ├── resource-adapter.ts     # Converts MCP resources to PonyBunny resources
│   └── prompt-adapter.ts       # Converts MCP prompts to PonyBunny prompts
├── config/
│   ├── mcp-config-loader.ts    # Load MCP configuration
│   └── mcp-config.schema.json  # JSON Schema for validation
└── index.ts                    # Public API
```

### Configuration Schema

`~/.ponybunny/mcp-config.json`:

```json
{
  "$schema": "./mcp-config.schema.json",
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/nickma/workspace"],
      "env": {},
      "allowedTools": ["read_file", "write_file", "list_directory"],
      "autoReconnect": true,
      "timeout": 30000
    },
    "github": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      },
      "allowedTools": ["*"],
      "autoReconnect": true
    },
    "sentry": {
      "enabled": false,
      "transport": "http",
      "url": "https://mcp.sentry.io",
      "headers": {
        "Authorization": "Bearer ${SENTRY_TOKEN}"
      },
      "allowedTools": ["search_issues", "get_issue"]
    }
  }
}
```

### Integration Points

#### 1. Tool Registry Integration

MCP tools are registered into the existing `ToolRegistry` during system initialization:

```typescript
// src/infra/tools/tool-registry.ts (enhanced)
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private mcpTools = new Map<string, MCPToolDefinition>();

  registerMCPTool(serverName: string, tool: MCPToolDefinition): void {
    const adaptedTool = MCPToolAdapter.toToolDefinition(serverName, tool);
    this.tools.set(adaptedTool.name, adaptedTool);
    this.mcpTools.set(adaptedTool.name, tool);
  }
}
```

#### 2. Tool Execution Flow

When the agent calls an MCP tool:

```
Agent → ToolRegistry.getTool(name)
      → Check if MCP tool
      → MCPConnectionManager.getClient(serverName)
      → MCPClient.callTool(toolName, args)
      → Return result to agent
```

#### 3. Lifecycle Management

```typescript
// Initialization sequence
1. Load mcp-config.json
2. For each enabled server:
   a. Create MCP client (stdio or HTTP)
   b. Initialize connection
   c. Negotiate capabilities
   d. List available tools
   e. Register tools in ToolRegistry
3. Set up notification handlers for tool changes
```

## Implementation Plan

### Phase 1: Core Infrastructure (Current)

- [ ] Install `@modelcontextprotocol/sdk` dependency
- [ ] Create MCP client wrapper for stdio transport
- [ ] Create MCP client wrapper for HTTP transport
- [ ] Implement connection manager
- [ ] Create configuration loader with JSON Schema validation

### Phase 2: Tool Integration

- [ ] Implement tool adapter (MCP → PonyBunny)
- [ ] Enhance ToolRegistry to support MCP tools
- [ ] Implement tool execution routing
- [ ] Add error handling and retry logic

### Phase 3: Advanced Features

- [ ] Implement resource adapter
- [ ] Implement prompt adapter
- [ ] Add notification handlers (tool list changes)
- [ ] Add connection health monitoring
- [ ] Implement auto-reconnect logic

### Phase 4: CLI & Testing

- [ ] Add `pb mcp list` command
- [ ] Add `pb mcp add <server>` command
- [ ] Add `pb mcp remove <server>` command
- [ ] Add `pb mcp test <server>` command
- [ ] Write integration tests
- [ ] Write E2E tests with real MCP servers

## Tool Naming Convention

MCP tools are namespaced to avoid conflicts:

```
Format: mcp_<server_name>_<tool_name>

Examples:
- mcp_filesystem_read_file
- mcp_github_create_issue
- mcp_sentry_search_issues
```

## Security Considerations

1. **Tool Allowlist**: Each MCP server has an `allowedTools` list
2. **Environment Variables**: Sensitive tokens loaded from environment
3. **Sandboxing**: MCP servers run in separate processes (stdio)
4. **Timeout**: All MCP calls have configurable timeouts
5. **Validation**: All configurations validated against JSON Schema

## Error Handling

```typescript
try {
  const result = await mcpClient.callTool(toolName, args);
  return result;
} catch (error) {
  if (error instanceof MCPConnectionError) {
    // Attempt reconnection
    await connectionManager.reconnect(serverName);
    // Retry once
    return await mcpClient.callTool(toolName, args);
  } else if (error instanceof MCPToolError) {
    // Tool execution failed - escalate to user
    throw new ToolExecutionError(`MCP tool failed: ${error.message}`);
  } else {
    // Unknown error - log and escalate
    logger.error('MCP error', { error, serverName, toolName });
    throw error;
  }
}
```

## Monitoring & Observability

MCP integration will emit events for:

- Connection established/lost
- Tool discovery
- Tool execution (success/failure)
- Notification received
- Configuration changes

These events integrate with the existing Debug Server for real-time monitoring.

## Future Enhancements

1. **Resource Caching**: Cache MCP resources for performance
2. **Prompt Templates**: Integrate MCP prompts into agent system prompts
3. **Sampling Support**: Allow MCP servers to request LLM completions
4. **Elicitation Support**: Allow MCP servers to request user input
5. **Task Support**: Support long-running MCP tasks
6. **Server Discovery**: Auto-discover MCP servers on the network

## References

- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Server Examples](https://github.com/modelcontextprotocol/servers)
