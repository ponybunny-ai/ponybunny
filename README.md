# PonyBunny

Autonomous AI Employee CLI and runtime for goal-driven execution.

PonyBunny is a local-first system that combines:
- a Gateway (WebSocket control plane),
- a Scheduler (autonomous execution engine),
- a CLI/TUI for interactive operations,
- SQLite-backed persistence for goals, runs, and artifacts.

If you prefer Chinese, see `README_ZH.md`.

## What It Does

- Goal to result workflow: submit work, execute, verify, and inspect outputs.
- Human-in-the-loop where needed: approvals/escalations are first-class in the flow.
- Multi-model support through configurable provider and model routing.
- Built-in observability via debug TUI and debug web server.

## Current Scope (actual repo state)

- Implemented and actively wired:
  - `pb` default interactive TUI (`src/cli/tui/`)
  - `pb gateway ...`, `pb scheduler ...`, `pb service ...`
  - `pb debug tui|web|start|stop|status|logs`
  - `pb work`, `pb results`, `pb mcp ...`, `pb skills ...`, `pb agent ...`
- Important caveat:
  - `pb webui ...` exists, but currently prints guidance and is not fully managed by CLI yet (`src/cli/commands/webui.ts`).

## Quick Start

### 1) Install and build

```bash
git clone https://github.com/ponybunny-ai/ponybunny.git
cd ponybunny
npm install
npm run build:cli
```

Optional for local command usage:

```bash
npm link
```

If you do not link, run CLI with:

```bash
node dist/cli/index.js --help
```

### 2) Initialize config files

```bash
pb init
pb init --list
```

By default config is stored under:
- `~/.config/ponybunny/`

Legacy `~/.ponybunny/` files are migrated automatically when applicable.

### 3) Add credentials and model config

Edit these files:
- `~/.config/ponybunny/credentials.json`
- `~/.config/ponybunny/llm-config.json`
- `~/.config/ponybunny/ponybunny.json`

Then verify:

```bash
pb status
```

### 4) Start services

```bash
pb service start all
pb service status
```

### 5) Use the interactive TUI

```bash
pb
```

By default it connects to `ws://127.0.0.1:18789`.

## Common Workflows

### Service lifecycle

```bash
pb service start all
pb service stop all
pb service restart all
pb service logs gateway -f
pb service logs scheduler -f
pb service ps
```

### Direct gateway/scheduler management

```bash
pb gateway start
pb gateway status
pb gateway pair
pb gateway tokens

pb scheduler start
pb scheduler status
pb scheduler logs -f
```

### Autonomous execution

```bash
pb work "Build a feature and include tests"
pb results
pb results --run <run-id>
```

### Debugging and observability

```bash
pb debug tui
pb debug web
pb debug start
pb debug status
pb debug logs -f
```

### Skills and MCP

```bash
pb skills search <query>
pb skills install <publisher/skill>
pb skills list --stats

pb mcp list
pb mcp add <name>
pb mcp test <name>
pb mcp inspector <name>
```

## CLI Surface (top-level)

From `pb --help`:

- `auth` - authentication commands
- `config` - configuration commands
- `models` - model list/probe commands
- `gateway` - gateway management
- `scheduler` - scheduler daemon management
- `debug` - debug TUI/Web and debug server lifecycle
- `init` - initialize config files
- `install` - install runtime bundle under `~/.ponybunny`
- `service` - unified service manager
- `reset` - reset database
- `mcp` - MCP connection management
- `prompts` - prompt diagnostics
- `agent` - main agent selection/customization
- `results` - inspect completed runs/artifacts
- `webui` - web UI helper commands (limited management)
- `work` - assign a task to autonomous execution
- `skills` - discover/install/list skills
- `status` - system + auth status

## Architecture Overview

High-level runtime flow:

```text
CLI/TUI -> Gateway (WebSocket) -> Scheduler -> Execution/LLM/Tools
                                -> SQLite persistence (goals, work items, runs, artifacts)
```

Core source layout:

```text
src/
  app/              Application services
  autonomy/         Autonomous execution components
  cli/              Commander CLI + Ink TUI
  debug/            Debug API/server integrations
  domain/           Core domain logic
  gateway/          Gateway server and auth
  infra/            Config, persistence, LLM, MCP, tools
  ipc/              Inter-process communication utilities
  scheduler/        Scheduler runtime
  scheduler-daemon/ Daemon wrapper and process management
  work-order/       Work order entities and DB manager
```

## Development

### Build

```bash
npm run build
npm run build:cli
```

### Test

```bash
npm test
npm run test:cli
npm run test:gateway
npm run test:scheduler
npm run test:coverage
```

### Useful local checks

```bash
node dist/cli/index.js --help
pb status
pb service status
```

## Documentation

- Main docs index: `docs/README.md`
- CLI docs: `docs/cli/CLI-USAGE.md`
- Developer guide: `docs/development/AGENTS.md`
- Architecture specs: `docs/techspec/`

## License

MIT
