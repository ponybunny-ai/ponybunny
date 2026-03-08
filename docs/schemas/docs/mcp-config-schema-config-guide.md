# `mcp-config.schema.json` Configuration Guide

This guide explains every field in `docs/schemas/mcp-config.schema.json`.

## Purpose

`mcp-config.json` configures external MCP servers used by runtime tooling. It controls transport mode, process launch details (stdio), HTTP endpoints, allowlists, reconnect behavior, and per-server timeout.

## Full Example

```json
{
  "$schema": "https://ponybunny.dho.ai/schemas/mcp-config.schema.json",
  "mcpServers": {
    "fs": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/workspace"],
      "env": {
        "NODE_OPTIONS": "--max-old-space-size=2048"
      },
      "allowedTools": ["*"],
      "autoReconnect": true,
      "timeout": 30000
    },
    "playwright": {
      "enabled": true,
      "transport": "http",
      "url": "http://localhost:17777/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      },
      "allowedTools": ["playwright.navigate", "playwright.get_content"],
      "autoReconnect": true,
      "timeout": 60000
    }
  }
}
```

## Top-Level Fields

- `$schema`: Schema URI for validation.
- `mcpServers`: Map of server ID -> MCP server config object.

## `mcpServers.<serverId>` Reference

- `enabled` (`boolean`, default `true`): Include this MCP server in runtime connection attempts.
- `transport` (`stdio|http`, required): Communication mode.
- `command` (`string`, stdio mode): Process command (for example `npx`, `node`, custom binary).
- `args` (`string[]`, stdio mode): Arguments passed to command.
- `env` (`object<string,string>`, optional): Process environment overrides.
- `url` (`uri`, http mode): MCP endpoint URL.
- `headers` (`object<string,string>`, optional): HTTP headers for auth/routing.
- `allowedTools` (`string[]`, default `[*]`): Tool allowlist.
  - `*` means all tools from this server.
- `autoReconnect` (`boolean`, default `true`): Reconnect after disconnection.
- `timeout` (`1000-300000`, default `30000`): Operation timeout in milliseconds.

## Conditional Required Fields

- When `transport = "stdio"`:
  - `command` is required
  - `args` is required
- When `transport = "http"`:
  - `url` is required

## Operational Behavior

- Disabled servers remain in config but are not actively used.
- `allowedTools` is a safety boundary; prefer explicit allowlists in production.
- `timeout` should be increased for slow remote servers, lowered for strict latency budgets.

## Recommended Patterns

- Local MCP servers: use `stdio` + pinned args for deterministic startup.
- Hosted MCP servers: use `http` + authentication headers.
- Security-sensitive deployments: avoid `"*"` and enumerate tools explicitly.
