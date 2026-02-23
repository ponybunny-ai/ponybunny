# Agent Resource Selection Config

This document explains how to configure skill and MCP selection policy in each `agents/<id>/agent.json` file.

## Fields

Under `policy`, two optional objects are supported:

- `skills`
  - `available`: preferred/allowed skill names
  - `denied`: blocked skill names
- `mcp`
  - `available`: preferred/allowed MCP selectors
  - `denied`: blocked MCP selectors

## Required value format

### skills

Use skill folder names (the skill name), for example:

- `backend-developer`
- `brainstorming`
- `writing`

Wildcards are supported in matching (`*`), but use exact names when possible for deterministic behavior.

### mcp

Use `mcp_server_name.tool_name` format, for example:

- `filesystem.read_file`
- `github.search_repositories`
- `postgres.query`

Wildcards are supported in the `tool_name` part, for example:

- `github.*`

## Precedence rules

At runtime:

1. `denied` always wins.
2. If `available` is non-empty, only matching candidates are kept.
3. Remaining candidates are ranked against task keywords.
4. If too many candidates remain, execution pauses and raises an escalation for human narrowing.

## Example

```json
{
  "policy": {
    "skills": {
      "available": ["backend-developer", "brainstorming"],
      "denied": ["playwright"]
    },
    "mcp": {
      "available": ["github.search_repositories", "postgres.query"],
      "denied": ["browser.open_url", "browser.*"]
    }
  }
}
```

## Notes on `pb agent customize`

`pb agent customize <id>` copies both files from the repository agent directory to the user config directory:

- source: `<repo>/agents/<id>/agent.json`, `<repo>/agents/<id>/AGENT.md`
- target: `~/.config/ponybunny/agents/<id>/agent.json`, `~/.config/ponybunny/agents/<id>/AGENT.md`

So any updates in repository `agents/<id>/agent.json` are included in customize output.
