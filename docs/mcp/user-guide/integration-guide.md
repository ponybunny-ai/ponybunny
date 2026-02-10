# MCP Integration Guide

## Overview

PonyBunny now supports the Model Context Protocol (MCP), enabling seamless integration with external tools and services through a standardized protocol.

## What is MCP?

Model Context Protocol (MCP) is an open-source standard for connecting AI applications to external systems. Think of it like USB-C for AI applications - a standardized way to connect to data sources, tools, and workflows.

## Quick Start

### 1. Initialize MCP Configuration

```bash
pb mcp init
```

This creates `~/.ponybunny/mcp-config.json` with example configurations.

### 2. Configure MCP Servers

Edit `~/.ponybunny/mcp-config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"],
      "allowedTools": ["read_file", "write_file", "list_directory"],
      "autoReconnect": true,
      "timeout": 30000
    }
  }
}
```

### 3. Test Connection

```bash
pb mcp test filesystem
```

### 4. Start Using MCP Tools

Once configured, MCP tools are automatically available to the PonyBunny agent with the naming convention:

```
mcp_<server_name>_<tool_name>
```

For example:
- `mcp_filesystem_read_file`
- `mcp_github_create_issue`
- `mcp_postgres_query`

## CLI Commands

### List Configured Servers

```bash
pb mcp list
```

Shows all configured MCP servers with their status and configuration.

### Check Connection Status

```bash
pb mcp status
```

Shows real-time connection status of all MCP servers.

### Add a New Server

**Stdio Transport:**
```bash
pb mcp add myserver \
  --transport stdio \
  --command npx \
  --args "-y" "@modelcontextprotocol/server-myserver"
```

**HTTP Transport:**
```bash
pb mcp add myserver \
  --transport http \
  --url https://mcp.example.com
```

### Remove a Server

```bash
pb mcp remove myserver
```

### Enable/Disable a Server

```bash
pb mcp enable myserver
pb mcp disable myserver
```

### Test Connection

```bash
pb mcp test myserver
```

## Configuration Reference

### Server Configuration Schema

```typescript
{
  "enabled": boolean,           // Whether this server is enabled (default: true)
  "transport": "stdio" | "http", // Transport mechanism

  // Stdio transport options
  "command": string,            // Command to execute (e.g., "npx", "node")
  "args": string[],             // Command arguments
  "env": {                      // Environment variables
    "KEY": "value"              // Supports ${VAR} expansion
  },

  // HTTP transport options
  "url": string,                // Server URL
  "headers": {                  // HTTP headers (e.g., for auth)
    "Authorization": "Bearer ${TOKEN}"
  },

  // Common options
  "allowedTools": string[],     // Allowed tool names, or ["*"] for all
  "autoReconnect": boolean,     // Auto-reconnect on disconnect (default: true)
  "timeout": number             // Timeout in ms (default: 30000)
}
```

### Environment Variable Expansion

Configuration values support `${VAR_NAME}` syntax for environment variables:

```json
{
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  },
  "headers": {
    "Authorization": "Bearer ${API_TOKEN}"
  }
}
```

## Available MCP Servers

### Official Servers

1. **Filesystem** - File operations
   ```bash
   npx -y @modelcontextprotocol/server-filesystem /path/to/workspace
   ```

2. **GitHub** - GitHub API integration
   ```bash
   npx -y @modelcontextprotocol/server-github
   ```
   Requires: `GITHUB_TOKEN` environment variable

3. **PostgreSQL** - Database queries
   ```bash
   npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb
   ```

4. **Slack** - Slack integration
   ```bash
   npx -y @modelcontextprotocol/server-slack
   ```
   Requires: `SLACK_BOT_TOKEN` environment variable

5. **Google Drive** - Google Drive access
   ```bash
   npx -y @modelcontextprotocol/server-gdrive
   ```

See [MCP Servers Repository](https://github.com/modelcontextprotocol/servers) for more.

## Security Considerations

### Tool Allowlist

Each MCP server has an `allowedTools` configuration:

```json
{
  "allowedTools": ["read_file", "write_file"]  // Only these tools allowed
}
```

Or allow all tools:

```json
{
  "allowedTools": ["*"]  // All tools allowed
}
```

### Environment Variables

Sensitive credentials should be stored in environment variables, not in the config file:

```json
{
  "env": {
    "API_KEY": "${MY_API_KEY}"  // Loaded from environment
  }
}
```

### Process Isolation

Stdio transport servers run in separate processes, providing isolation from the main PonyBunny process.

## Troubleshooting

### Connection Fails

1. Check if the MCP server package is installed:
   ```bash
   npm list -g @modelcontextprotocol/server-filesystem
   ```

2. Test the command manually:
   ```bash
   npx -y @modelcontextprotocol/server-filesystem /path/to/workspace
   ```

3. Check logs:
   ```bash
   pb mcp status
   ```

### Tools Not Available

1. Verify server is enabled:
   ```bash
   pb mcp list
   ```

2. Check connection status:
   ```bash
   pb mcp status
   ```

3. Verify tool is in allowlist:
   ```bash
   cat ~/.ponybunny/mcp-config.json
   ```

### Environment Variables Not Expanding

Ensure environment variables are set before starting PonyBunny:

```bash
export GITHUB_TOKEN="your-token"
pb service start all
```

## Architecture

### Components

```
┌─────────────────────────────────────────┐
│         PonyBunny Agent                 │
│  ┌───────────────────────────────────┐  │
│  │      Tool Registry                │  │
│  │  ┌─────────────┐  ┌────────────┐ │  │
│  │  │ Native Tools│  │ MCP Tools  │ │  │
│  │  └─────────────┘  └────────────┘ │  │
│  └───────────────────────────────────┘  │
│              │                           │
│              ▼                           │
│  ┌───────────────────────────────────┐  │
│  │   MCP Connection Manager          │  │
│  │  ┌──────────┐  ┌──────────┐      │  │
│  │  │ Client 1 │  │ Client 2 │ ...  │  │
│  │  └──────────┘  └──────────┘      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
              │           │
              ▼           ▼
      ┌──────────┐  ┌──────────┐
      │MCP Server│  │MCP Server│
      │    1     │  │    2     │
      └──────────┘  └──────────┘
```

### Tool Naming Convention

MCP tools are namespaced to avoid conflicts:

```
mcp_<server_name>_<tool_name>
```

Examples:
- `mcp_filesystem_read_file`
- `mcp_github_create_issue`
- `mcp_postgres_query`

### Lifecycle

1. **Initialization**: Connection manager reads config and connects to enabled servers
2. **Discovery**: Each server's tools are discovered and registered
3. **Execution**: Agent calls tools through the connection manager
4. **Monitoring**: Connection manager handles reconnections and notifications
5. **Shutdown**: All connections gracefully closed

## Advanced Usage

### Dynamic Tool Discovery

MCP servers can notify PonyBunny when their tool list changes. The connection manager automatically refreshes the tool registry.

### Custom MCP Servers

You can create custom MCP servers using the MCP SDK:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server({
  name: 'my-custom-server',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'my_tool',
        description: 'My custom tool',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          },
        },
      },
    ],
  };
});

// ... implement tool handlers
```

See [MCP Documentation](https://modelcontextprotocol.io) for details.

## References

- [MCP Specification](https://modelcontextprotocol.io/specification/latest)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Server Examples](https://github.com/modelcontextprotocol/servers)
- [PonyBunny MCP Integration Design](../techspec/mcp-integration.md)
