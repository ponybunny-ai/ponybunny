# 08 - CLI & TUI Reference

## 8.1 CLI Overview

The CLI binary is `pb` (PonyBunny), built with Commander.js. Entry point: `src/cli/index.ts`.

Default action (no subcommand): starts the interactive TUI with WebSocket connection to Gateway.

Global options:
- `-u, --url <url>` — Gateway URL (default: `ws://127.0.0.1:18789`)
- `-t, --token <token>` — Auth token

## 8.2 Command Reference

### Service Management

| Command | Description |
|---------|-------------|
| `pb service status` | Show all services (gateway, scheduler, web-ui) with PID, port, uptime |
| `pb service start all\|gateway\|scheduler` | Start services |
| `pb service stop all\|gateway\|scheduler` | Stop services |

### Gateway

| Command | Options | Description |
|---------|---------|-------------|
| `pb gateway start` | `-h/--host`, `-p/--port`, `-d/--db`, `-m/--memory-db`, foreground/background/daemon | Start WebSocket server |
| `pb gateway stop` | | Stop gateway |
| `pb gateway restart` | | Restart gateway |
| `pb gateway status` | | PID, uptime, connections |
| `pb gateway logs` | `-f` (follow) | View/tail logs |
| `pb gateway pair` | | Generate pairing token |

### Scheduler

| Command | Options | Description |
|---------|---------|-------------|
| `pb scheduler start` | `--db`, `--socket`, `--agents`, `--persona`, `--main-agent`, `--foreground` | Start execution daemon |
| `pb scheduler stop` | | Stop daemon |
| `pb scheduler restart` | | Restart daemon |
| `pb scheduler status` | | Status, uptime, active goals |
| `pb scheduler logs` | `-f` (follow) | View/tail logs |

### Work Execution

| Command | Options | Description |
|---------|---------|-------------|
| `pb work <task>` | `--model <model>`, `--db <path>` | Execute task via autonomous agent (direct mode) |

Output: execution summary, tokens used, cost, time, artifacts, execution log.

### Agent Management

| Command | Description |
|---------|-------------|
| `pb agent list` | List built-in and user agents |
| `pb agent use <id>` | Select main agent (enables scheduler agents) |
| `pb agent customize <id>` | Copy system agent to user config (`-f/--force`) |
| `pb agent status` | Show main agent, diff with user overrides |

### Authentication

| Command | Description |
|---------|-------------|
| `pb auth login` | OpenAI OAuth login flow |
| `pb auth logout` | Revoke OpenAI token |
| `pb auth list` | List authenticated accounts |
| `pb auth antigravity login` | Google Antigravity OAuth |
| `pb auth antigravity list` | List Antigravity accounts |
| `pb auth antigravity remove <id>` | Remove Antigravity account |

### Configuration

| Command | Description |
|---------|-------------|
| `pb config show` | Display current config (email, auth status) |
| `pb config backup` | Backup config with optional encryption |
| `pb config restore` | Restore from backup with passcode |
| `pb init` | Initialize config files (`--list`, `--dry-run`, `--force`) |

### Model Management

| Command | Description |
|---------|-------------|
| `pb models list` | Display provider/model tree with availability, costs |
| `pb models test <model>` | Test specific model with completion request |

### Debug & Observability

| Command | Description |
|---------|-------------|
| `pb debug tui` | Terminal debug UI (default) |
| `pb debug web` | Web debug dashboard (`-h`, `-p`, `-w`) |
| `pb debug start` | Start debug server in background |
| `pb debug stop` | Stop debug server |
| `pb debug status` | Check debug server status |
| `pb debug logs` | View debug logs (`-f`) |

### Runtime Events

| Command | Description |
|---------|-------------|
| `pb events tail` | Stream events in real-time (`-n`, `--poll-ms`) |
| `pb events replay <goalId>` | Replay events for a goal |

### Results Inspection

| Command | Description |
|---------|-------------|
| `pb results show <runId>` | Detailed run result (summary, status, tokens, cost, artifacts) |
| `pb results list <goalId>` | All runs for a goal |

### Skills

| Command | Options | Description |
|---------|---------|-------------|
| `pb skills search <query>` | `-l/--limit`, `-t/--tags`, `-a/--author` | Search skills.sh marketplace |
| `pb skills install <path>` | | Install skill (e.g., `vercel-labs/skills/find-skills`) |
| `pb skills list` | `-s/--source`, `-p/--phase`, `--stats` | List installed skills by source |

### MCP Servers

| Command | Description |
|---------|-------------|
| `pb mcp list` | Show configured MCP servers |
| `pb mcp status` | Check connection status |
| `pb mcp add` | Add MCP server |
| `pb mcp remove` | Remove MCP server |
| `pb mcp enable` / `disable` | Toggle server |

### Other

| Command | Description |
|---------|-------------|
| `pb status` | System health (auth status, provider connectivity) |
| `pb reset` | Reset database (`--db`, `-y`, `--no-stop-services`) |
| `pb install` | Install pb runtime bundle (`--force`, `--dry-run`) |
| `pb prompts doctor` | Validate prompt templates and manifests |

## 8.3 TUI Architecture

**Source**: `src/cli/tui/`

### Technology

- **Ink** — React renderer for the terminal
- **React 19** — Component model
- **Redux-like state management** — Store with reducer + actions

### Component Structure

```
tui/
├── start.ts                    # Entry: renders App component
├── index.ts                    # Exports
│
├── store/                      # State management
│   ├── types.ts                #   State shape (goals, workItems, runs, sessions)
│   ├── actions.ts              #   Action creators
│   ├── reducer.ts              #   State reducer
│   └── index.ts                #   Store setup
│
├── context/                    # React Context providers
│   ├── app-context.ts          #   Global app state
│   └── gateway-context.ts      #   WebSocket connection
│
├── commands/                   # Command/REPL system
│   ├── registry.ts             #   Command registration
│   ├── handlers.ts             #   Command execution
│   ├── command-catalog.ts      #   Built-in command definitions
│   └── index.ts
│
├── components/                 # UI components
│   ├── layout/
│   │   ├── input-bar.ts                 # Command input
│   │   ├── input-normalize.ts           # Input event normalization
│   │   ├── input-focus-guard.ts         # Focus management
│   │   ├── input-mouse-sanitize.ts      # Mouse event filtering
│   │   ├── input-suggestion-window.ts   # Autocomplete suggestions
│   │   └── input-suggestion-state.ts    # Suggestion state
│   ├── modals/
│   │   ├── command-palette-state.ts     # Command palette
│   │   └── model-selector-input-sanitize.ts
│   ├── views/                  # Main views (goals, tasks, conversations)
│   └── widgets/                # Reusable widgets
│
├── hooks/                      # Custom React hooks
│   ├── use-gateway.ts          #   Gateway WebSocket connection
│   ├── use-goals.ts            #   Goals state
│   ├── use-keyboard.ts         #   Keyboard input
│   └── use-terminal-size.ts    #   Terminal dimensions
│
└── utils/                      # Utilities
    ├── colors.ts               #   Color/formatting
    ├── formatters.ts           #   Data formatting
    ├── markdown-render.ts      #   Markdown → terminal rendering
    ├── conversation-render-state.ts
    ├── conversation-pending-state.ts
    └── agent-selection.ts
```

### Rendering

- Maximum 20 FPS rendering rate
- Incremental updates via React reconciliation
- Markdown rendering for LLM responses (via `markdansi`)
- Syntax highlighting (via `cli-highlight`)

### State Management

```typescript
AppState {
  goals: Map<goalId, Goal>
  workItems: Map<workItemId, WorkItem>
  runs: Map<runId, Run>
  sessions: Map<sessionId, Session>
  activeView: 'conversation' | 'goals' | 'debug' | ...
  connectionStatus: 'connecting' | 'connected' | 'disconnected'
  // ...
}
```

### Gateway Connection

The TUI connects to the Gateway WebSocket and:
1. Auto-authenticates (local connections get full permissions)
2. Subscribes to events
3. Dispatches RPC calls for user actions
4. Updates store on received events
5. Reconnects on disconnection

## 8.4 Process Lifecycle

### Starting All Services

```bash
pb service start all
```

This starts:
1. **Gateway** — Background process, writes PID to `~/.config/ponybunny/gateway.pid`
2. **Scheduler Daemon** — Background process, connects to Gateway via IPC

### Service Status

```bash
pb service status
```

Shows per-service: PID, port, address, uptime, mode (foreground/background/daemon).

### Interactive TUI

```bash
pb
```

1. Connects to Gateway at `ws://127.0.0.1:18789`
2. Auto-authenticates (local connection)
3. Renders interactive chat/goal interface
4. Real-time event updates via WebSocket subscription

### Direct Execution

```bash
pb work "implement feature X" --model claude-sonnet-4-5
```

Bypasses TUI, runs autonomous execution directly, outputs summary to terminal.
