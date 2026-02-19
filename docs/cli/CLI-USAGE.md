# PonyBunny CLI Usage Guide

Complete reference for the `pb` command-line interface.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Global Options](#global-options)
- [Commands Overview](#commands-overview)
- [Authentication](#authentication)
- [Configuration](#configuration)
- [Service Management](#service-management)
- [Gateway Management](#gateway-management)
- [Scheduler Management](#scheduler-management)
- [Debug & Observability](#debug--observability)
- [Model Management](#model-management)
- [Work Execution](#work-execution)
- [Examples](#examples)

---

## Installation

```bash
# Build the CLI binary
npm run build:cli

# The pb command will be available in your PATH
```

---

## Quick Start

```bash
# 1. Initialize configuration files
pb init

# 2. Authenticate with a provider
pb auth login

# 3. Check system status
pb status

# 4. Start all services
pb service start all

# 5. Launch the interactive TUI
pb
```

---

## Global Options

When running `pb` without any command, it launches the interactive Terminal UI (TUI):

```bash
pb [options]

Options:
  -u, --url <url>       Gateway URL (default: ws://127.0.0.1:18789)
  -t, --token <token>   Authentication token
  -V, --version         Output the version number
  -h, --help            Display help for command
```

---

## Commands Overview

| Command | Description |
|---------|-------------|
| `pb init` | Initialize configuration files |
| `pb status` | Check system and authentication status |
| `pb auth` | Authentication management |
| `pb config` | Configuration management |
| `pb models` | Model list management |
| `pb service` | Unified service management |
| `pb gateway` | Gateway server management |
| `pb scheduler` | Scheduler daemon management |
| `pb debug` | Debug/observability tools |
| `pb work` | Execute autonomous tasks |

---

## Authentication

### `pb auth login`

Authenticate with an AI provider. Supports multiple providers and accounts.

```bash
pb auth login
```

**Interactive prompts:**
- **OpenAI Codex (OAuth)** - Browser-based OAuth flow
- **Google Antigravity (OAuth)** - Google Cloud authentication
- **OpenAI-Compatible API (API Key)** - Custom API endpoints

**Features:**
- Multi-account support (add multiple accounts per provider)
- Secure token storage in `~/.ponybunny/auth.json`
- Automatic token refresh for OAuth providers

### `pb auth logout`

Clear all authentication credentials.

```bash
pb auth logout
```

### `pb auth whoami`

Display current authenticated user information.

```bash
pb auth whoami
```

**Output:**
```
Current Account:
  User: user@example.com
  Token expires: 2026-02-15T10:30:00.000Z
  Strategy: stick
```

### `pb auth list`

List all authenticated accounts across all providers.

```bash
pb auth list
```

**Output:**
```
📋 Accounts (3 total) - Strategy: round-robin

Enabled providers: ✓ Found

- OpenAI OAuth
  Status: Enabled

- OpenAI-Compatible
  Status: Enabled
  API Key: sk-compatible-ab***

- Anthropic Direct
  Status: Enabled
  API Key: sk-ant-1234567***

OpenAI Codex (2)
──────────────────────────────────────────────────
➤ 1. user@example.com
     ID: acc_abc123
     Added: 2026-02-08T10:00:00.000Z
     Status: Valid (expires 2026-02-15T10:00:00.000Z)

  2. user2@example.com
     ID: acc_def456
     Added: 2026-02-07T15:30:00.000Z
     Status: Valid (expires 2026-02-14T15:30:00.000Z)

Google Antigravity (1)
──────────────────────────────────────────────────
  1. user@gmail.com
     ID: acc_ghi789
     Added: 2026-02-06T12:00:00.000Z
     Project: my-project-123
```

### `pb auth switch <identifier>`

Switch to a specific account (by email, userId, or account ID).

```bash
pb auth switch user@example.com
pb auth switch acc_abc123
```

### `pb auth remove <identifier>`

Remove an account from the system.

```bash
pb auth remove user@example.com
```

### `pb auth set-strategy <strategy>`

Set the load balancing strategy for multiple accounts.

```bash
pb auth set-strategy stick          # Use one account consistently
pb auth set-strategy round-robin    # Rotate through accounts
```

**Strategies:**
- `stick` - Use the current account for all requests
- `round-robin` - Distribute requests across accounts evenly

---

## Configuration

### `pb init`

Initialize PonyBunny configuration files in `~/.ponybunny/`.

```bash
pb init [options]

Options:
  -f, --force      Overwrite existing files
  --dry-run        Show what would be created without creating
  -l, --list       List all config files and their status
```

**Created files:**
- `credentials.json` - API keys and credentials
- `credentials.schema.json` - JSON Schema for credentials validation
- `llm-config.json` - LLM endpoint and model configuration
- `llm-config.schema.json` - JSON Schema for LLM configuration validation
- `mcp-config.json` - MCP server configuration (disabled by default)
- `mcp-config.schema.json` - JSON Schema for MCP configuration validation

**Examples:**
```bash
# Initialize with defaults
pb init

# List configuration status
pb init --list

# Force overwrite existing files
pb init --force

# Preview without creating
pb init --dry-run
```

### `pb config show`

Display current configuration.

```bash
pb config show
```

**Output:**
```
Current Configuration:

  Authenticated: Yes
  Email: user@example.com
  User ID: usr_abc123
```

### `pb status`

Check overall system and authentication status.

```bash
pb status
```

**Output:**
```
🔍 PonyBunny Status

Enabled providers: ✓ Found

- OpenAI OAuth
  Status: Enabled
  Provider: OpenAI
  User: user@example.com

- OpenAI-Compatible
  Status: Enabled

Testing enabled providers...
✓ OpenAI OAuth test successful
✓ OpenAI-Compatible test successful
```

---

## Service Management

Unified interface for managing all PonyBunny services.

### `pb service status`

Show status of all services.

```bash
pb service status
```

**Output:**
```
╔═══════════════════════════════════════════════════════════════╗
║           PonyBunny Services Status                           ║
╚═══════════════════════════════════════════════════════════════╝

  Gateway:
    ✓ Running
    PID: 12345
    Address: ws://127.0.0.1:18789
    Uptime: 2h 15m 30s
    Mode: daemon

  Scheduler:
    ✓ Running
    PID: 12346
    Uptime: 2h 15m 25s

  Debug Server:
    ✓ Running
    PID: 12347
    Address: http://localhost:3001
    Uptime: 1h 30m 10s

  Web UI:
    ✗ Not running
    Start: pb service start web
```

### `pb service start <service>`

Start a specific service or all services.

```bash
pb service start gateway      # Start Gateway only
pb service start scheduler    # Start Scheduler only
pb service start debug        # Start Debug Server only
pb service start web          # Start Web UI only
pb service start all          # Start all services

Options:
  --foreground    Run in foreground (default: background)
```

### `pb service stop <service>`

Stop a specific service or all services.

```bash
pb service stop gateway       # Stop Gateway only
pb service stop scheduler     # Stop Scheduler only
pb service stop debug         # Stop Debug Server only
pb service stop web           # Stop Web UI only
pb service stop all           # Stop all services

Options:
  -f, --force     Force kill with SIGKILL
```

### `pb service restart <service>`

Restart a service.

```bash
pb service restart gateway
pb service restart all
```

### `pb service logs <service>`

Show service logs.

```bash
pb service logs gateway [options]
pb service logs scheduler [options]
pb service logs debug [options]

Options:
  -f, --follow       Follow log output (like tail -f)
  -n, --lines <n>    Number of lines to show (default: 50)
```

**Examples:**
```bash
# Show last 50 lines
pb service logs gateway

# Show last 100 lines
pb service logs gateway -n 100

# Follow logs in real-time
pb service logs gateway -f
```

### `pb service ps`

Show detailed process information for all services.

```bash
pb service ps
```

**Output:**
```
╔═══════════════════════════════════════════════════════════════╗
║           PonyBunny Process Information                       ║
╚═══════════════════════════════════════════════════════════════╝

  Gateway:
    Status: Running
    PID: 12345
    Mode: daemon
    Started: 2026-02-08T08:00:00.000Z
    Uptime: 2h 15m 30s
    Address: ws://127.0.0.1:18789
    Database: /Users/user/.ponybunny/pony.db
    Log: /Users/user/.ponybunny/gateway.log

  Scheduler:
    Status: Running
    PID: 12346
    Mode: foreground
    Started: 2026-02-08T08:00:05.000Z
    Uptime: 2h 15m 25s
```

---

## Gateway Management

Low-level Gateway server management (prefer `pb service` for most use cases).

### `pb gateway start`

Start the Gateway WebSocket server.

```bash
pb gateway start [options]

Options:
  -h, --host <host>    Host to bind to (default: 127.0.0.1)
  -p, --port <port>    Port to listen on (default: 18789)
  -d, --db <path>      Database path (default: ./pony.db)
  -f, --force          Force start even if already running
  --foreground         Run in foreground (default: background)
  --daemon             Run with daemon supervisor (auto-restart)
  --debug              Enable debug mode for event tracing
```

**Examples:**
```bash
# Start in background (default)
pb gateway start

# Start in foreground
pb gateway start --foreground

# Start with daemon supervisor (auto-restart on crash)
pb gateway start --daemon

# Start on custom port
pb gateway start -p 8080

# Start with debug mode
pb gateway start --debug
```

### `pb gateway status`

Check Gateway server status and connectivity.

```bash
pb gateway status [options]

Options:
  -h, --host <host>    Gateway host (default: 127.0.0.1)
  -p, --port <port>    Gateway port (default: 18789)
```

### `pb gateway stop`

Stop the running Gateway server.

```bash
pb gateway stop [options]

Options:
  -p, --port <port>    Port to check for running process
  -f, --force          Force kill with SIGKILL
```

### `pb gateway ps`

Show running Gateway process information.

```bash
pb gateway ps [options]

Options:
  -p, --port <port>    Port to check for running process
```

### `pb gateway logs`

Show Gateway logs.

```bash
pb gateway logs [options]

Options:
  -f, --follow       Follow log output
  -n, --lines <n>    Number of lines to show (default: 50)
```

### `pb gateway pair`

Generate a pairing token for client authentication.

```bash
pb gateway pair [options]

Options:
  -d, --db <path>              Database path (default: ./pony.db)
  -p, --permissions <perms>    Comma-separated permissions (default: read,write)
  -e, --expires <hours>        Token expiration in hours, 0 = never (default: 24)
```

**Permissions:**
- `read` - Read-only access
- `write` - Read and write access
- `admin` - Full administrative access

**Examples:**
```bash
# Create token with read/write permissions (24h expiry)
pb gateway pair

# Create admin token that never expires
pb gateway pair -p read,write,admin -e 0

# Create read-only token (1 hour)
pb gateway pair -p read -e 1
```

### `pb gateway tokens`

List active pairing tokens.

```bash
pb gateway tokens [options]

Options:
  -d, --db <path>    Database path (default: ./pony.db)
```

### `pb gateway revoke <tokenId>`

Revoke a pairing token.

```bash
pb gateway revoke <tokenId> [options]

Options:
  -d, --db <path>    Database path (default: ./pony.db)
```

### `pb gateway tui`

Start the Gateway Terminal UI for monitoring.

```bash
pb gateway tui [options]

Options:
  -h, --host <host>      Gateway host (default: 127.0.0.1)
  -p, --port <port>      Gateway port (default: 18789)
  -t, --token <token>    Authentication token
```

---

## Scheduler Management

Manage the Scheduler Daemon that executes autonomous tasks.

### `pb scheduler start`

Start the Scheduler Daemon.

```bash
pb scheduler start [options]

Options:
  --foreground         Run in foreground (default: background)
  --db <path>          Database path (default: ~/.ponybunny/pony.db)
  --socket <path>      IPC socket path (default: ~/.ponybunny/gateway.sock)
  --debug              Enable debug mode
```

**Examples:**
```bash
# Start in foreground
pb scheduler start --foreground

# Start with debug mode
pb scheduler start --debug

# Start with custom database
pb scheduler start --db ./my-pony.db
```

### `pb scheduler stop`

Stop the Scheduler Daemon.

```bash
pb scheduler stop
```

**Note:** Currently requires manual termination (Ctrl+C) when running in foreground.

### `pb scheduler status`

Check Scheduler Daemon status.

```bash
pb scheduler status
```

---

## Debug & Observability

Tools for debugging and monitoring PonyBunny system.

### `pb debug` (or `pb debug tui`)

Launch the debug Terminal UI (default).

```bash
pb debug [tui] [options]

Options:
  -h, --host <host>      Gateway host (default: 127.0.0.1)
  -p, --port <port>      Gateway port (default: 18789)
  -d, --db <path>        Database path (default: ./pony.db)
  -t, --token <token>    Authentication token (auto-created if not provided)
```

**Features:**
- Real-time event monitoring
- Message flow tracing
- Work order inspection
- System metrics

### `pb debug web`

Launch the Debug Server with Web UI.

```bash
pb debug web [options]

Options:
  -h, --host <host>        Gateway host (default: 127.0.0.1)
  -p, --port <port>        Gateway port (default: 18789)
  -w, --web-port <port>    Debug Server HTTP port (default: 3001)
  -d, --db <path>          Main database path (default: ./pony.db)
  -t, --token <token>      Authentication token (auto-created if not provided)
  --debug-db <path>        Debug Server database path (default: ./debug.db)
  --no-open                Do not open browser automatically
```

**Features:**
- Web-based dashboard
- Event timeline visualization
- Work order management
- Real-time metrics
- API endpoints for integration

**Examples:**
```bash
# Start with defaults (opens browser automatically)
pb debug web

# Start on custom port without opening browser
pb debug web -w 8080 --no-open

# Start with custom database
pb debug web --debug-db ./my-debug.db
```

---

## Model Management

Manage cached model lists from AI providers.

### `pb models list`

List all available models from cache.

```bash
pb models list
```

**Output:**
```
📋 OpenAI Codex Models:
  1. GPT-5.2 Turbo
  2. GPT-5.2
  3. GPT-4o

📋 Antigravity Models:
  1. Gemini 2.0 Flash
  2. Gemini 1.5 Pro
  3. Gemini 1.5 Flash

Cache age: 5 hours ago
```

### `pb models refresh`

Refresh model lists from APIs.

```bash
pb models refresh
```

**Output:**
```
✓ Models refreshed successfully

✓ Cached 15 Codex models
✓ Cached 8 Antigravity models
```

### `pb models clear`

Clear cache and reset to defaults.

```bash
pb models clear
```

### `pb models info`

Show cache information.

```bash
pb models info
```

**Output:**
```
📊 Models Cache Info:
  Version: 1
  Last Updated: 2026-02-08T10:00:00.000Z
  Age: 5h 30m
  Valid for: 18 more hours
  Codex Models: 15
  Antigravity Models: 8
```

---

## Work Execution

Execute autonomous tasks directly from the CLI.

### `pb work <task>`

Assign a task to the autonomous agent.

```bash
pb work <task> [options]

Options:
  --db <path>    Path to SQLite database (default: ./pony-work-orders.db)
```

**Examples:**
```bash
# Simple task
pb work "Create a hello world script in Python"

# Complex task
pb work "Analyze the codebase and generate a dependency graph"

# With custom database
pb work "Fix the bug in auth.ts" --db ./my-db.db
```

**Output:**
```
🐴 PonyBunny Autonomous Agent

✓ System ready
  Using providers: anthropic-direct, openai-direct

📝 Task: Create a hello world script in Python

Starting ReAct cycle...
✓ Task completed successfully!

📊 Execution Summary:
  Success: Yes
  Tokens:  1,234
  Cost:    $0.0123
  Time:    5.2s

📜 Execution Log:
────────────────────────────────────────────────────────────────────────────────
[Thought] I need to create a Python script that prints "Hello, World!"
[Action] write_file
[Observation] File created: hello.py
[Thought] Task completed successfully
────────────────────────────────────────────────────────────────────────────────
```

---

## Examples

### Complete Setup Workflow

```bash
# 1. Initialize configuration
pb init

# 2. Authenticate with OpenAI Codex
pb auth login
# Select: OpenAI Codex (OAuth)
# Browser opens for authentication

# 3. Verify authentication
pb status

# 4. Refresh model lists
pb models refresh

# 5. Start all services
pb service start all

# 6. Check service status
pb service status

# 7. Launch debug UI
pb debug web
```

### Multi-Account Setup

```bash
# Add multiple Codex accounts
pb auth login
# Add first account...

pb auth login
# Add second account...

# List all accounts
pb auth list

# Set round-robin strategy
pb auth set-strategy round-robin

# Verify current account
pb auth whoami
```

### Development Workflow

```bash
# Start Gateway in foreground with debug mode
pb gateway start --foreground --debug

# In another terminal, start Scheduler
pb scheduler start --foreground --debug

# In another terminal, launch debug TUI
pb debug tui

# Execute a task
pb work "Implement user authentication"
```

### Production Deployment

```bash
# Start Gateway with daemon supervisor (auto-restart)
pb gateway start --daemon

# Start Scheduler in background
pb scheduler start

# Start Debug Server
pb debug web --no-open

# Check all services
pb service status

# View logs
pb service logs gateway -f
```

### Troubleshooting

```bash
# Check system status
pb status

# Check service status
pb service status

# View Gateway logs
pb service logs gateway -n 100

# Check Gateway process details
pb gateway ps

# Test Gateway connectivity
pb gateway status

# List active tokens
pb gateway tokens

# Stop all services and restart
pb service stop all
pb service start all
```

---

## Environment Variables

PonyBunny respects the following environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PONY_DB_PATH` | Main database path | `./pony.db` |
| `PONY_GATEWAY_HOST` | Gateway host | `127.0.0.1` |
| `PONY_GATEWAY_PORT` | Gateway port | `18789` |
| `DEBUG_SERVER_PORT` | Debug Server port | `3001` |
| `DEBUG_MODE` | Enable debug mode | `false` |

**Example:**
```bash
export PONY_DB_PATH=~/.ponybunny/pony.db
export PONY_GATEWAY_PORT=8080
pb gateway start
```

---

## Configuration Files

All configuration files are stored in `~/.ponybunny/`:

| File | Purpose |
|------|---------|
| `credentials.json` | API keys and credentials (sensitive) |
| `llm-config.json` | LLM endpoint and model configuration |
| `mcp-config.json` | MCP server configuration |
| `auth.json` | OAuth authentication tokens |
| `models-cache.json` | Cached model lists |
| `debug-config.json` | Debug server configuration |
| `services.json` | Service state tracking |
| `gateway.pid` | Gateway process information |
| `gateway.log` | Gateway logs |
| `scheduler.log` | Scheduler logs |
| `debug-server.log` | Debug Server logs |

---

## Getting Help

```bash
# General help
pb --help

# Command-specific help
pb auth --help
pb gateway --help
pb service --help

# Subcommand help
pb gateway start --help
pb auth login --help
```

---

## Feedback & Issues

To report issues or provide feedback:
- GitHub Issues: https://github.com/anthropics/claude-code/issues
- Run: `pb --help` for inline help

---

## See Also

- [Architecture Overview](../techspec/architecture-overview.md)
- [Gateway Design](../techspec/gateway-design.md)
- [Scheduler Design](../techspec/scheduler-design.md)
- [CLAUDE.md](../../CLAUDE.md) - Development guidelines
