# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PonyBunny is an **Autonomous AI Employee System** that solves the **delegation bottleneck** in knowledge work. Built on a **Gateway + Scheduler** architecture where humans set goals and AI delivers complete results autonomously.

**New**: PonyBunny now supports **Model Context Protocol (MCP)** for seamless integration with external tools and services. See `docs/cli/MCP-INTEGRATION.md` for details.

See `docs/techspec/architecture-overview.md` for detailed system architecture.

## Build, Test & Run Commands

```bash
# Build
npm run build              # Compile TypeScript to dist/
npm run build:cli          # Build CLI binary (pb command)

# Test
npm test                   # Run all Jest tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report
npx jest test/path/to/file.test.ts  # Single test file

# E2E and demos (run with tsx, not Jest)
npx tsx test/e2e-lifecycle.ts
npx tsx demo/autonomous-demo.ts

# Run daemon
PONY_DB_PATH=./pony.db node dist/main.js

# CLI (after build:cli)
pb init                    # Initialize config files
pb status                  # Check system status
pb auth login              # Login to OpenAI Codex

# Service Management
pb service start all       # Start Gateway + Scheduler in background
pb service status          # Check all services status
pb service stop all        # Stop all services
pb service logs gateway    # View Gateway logs
pb service logs scheduler  # View Scheduler logs

# Individual Services
pb gateway start           # Start Gateway (background by default)
pb gateway stop            # Stop Gateway
pb scheduler start         # Start Scheduler (background by default)
pb scheduler stop          # Stop Scheduler
pb scheduler logs -f       # Follow Scheduler logs

# Debug & Observability
pb debug web               # Launch Debug Server with Web UI
pb debug tui               # Launch Terminal UI (default)

# MCP (Model Context Protocol)
pb mcp init                # Initialize MCP configuration
pb mcp list                # List configured MCP servers
pb mcp status              # Show connection status
pb mcp add <name>          # Add new MCP server
pb mcp test <name>         # Test connection to server
```

## Critical Code Conventions

**ESM imports require `.js` extension:**
```typescript
import { Goal } from './types.js';           // ✅ Correct
import { Goal } from './types';              // ❌ Wrong
```

**Naming:**
- Classes: `PascalCase` (e.g., `IntakeService`)
- Interfaces: `I`-prefix (e.g., `IWorkOrderRepository`)
- Files: `kebab-case` (e.g., `state-machine.ts`)
- Database fields: `snake_case` (e.g., `goal_id`, `spent_tokens`)

**State transitions must be validated:**
```typescript
if (canTransitionWorkItem(item.status, 'in_progress')) {
  repository.updateWorkItemStatus(item.id, 'in_progress');
}
```

**Dependency injection via constructor** - never instantiate dependencies inside services.

## Code Organization

```
src/
├── gateway/          # WS/WSS server, connection management, message routing
├── scheduler/        # Core brain - task orchestration, model/lane selection
│   └── agent/        # Agent logic for the 8-phase lifecycle
├── domain/           # Pure business logic, NO external dependencies
│   ├── work-order/   # Goal, WorkItem, Run, Artifact types
│   ├── skill/        # Skill definitions and registry
│   └── state-machine # Status transition rules
├── infra/            # Infrastructure adapters
│   ├── config/       # Configuration & onboarding (credentials, llm-config)
│   ├── persistence/  # SQLite repository
│   ├── llm/          # LLM providers with router failover
│   │   ├── provider-manager/  # JSON config-driven provider management
│   │   ├── protocols/         # Anthropic, OpenAI, Gemini adapters
│   │   └── routing/           # Model routing & fallback
│   ├── tools/        # Tool registry & allowlist
│   ├── skills/       # Skill implementations
│   └── mcp/          # Model Context Protocol integration
│       ├── client/   # MCP client and connection manager
│       ├── config/   # MCP configuration loader
│       └── adapters/ # Tool/resource/prompt adapters
├── autonomy/         # ReAct integration & daemon
├── cli/              # Commander.js CLI with Ink terminal UI
│   └── commands/     # CLI command implementations
│       ├── auth.ts           # Authentication management
│       ├── config.ts         # Configuration commands
│       ├── debug.ts          # Debug/observability tools
│       ├── gateway.ts        # Gateway management
│       ├── scheduler-daemon.ts # Scheduler daemon control
│       ├── service.ts        # Unified service management
│       └── work.ts           # Work execution
└── app/              # Application services
    └── conversation/ # Conversation agent
```

## Key Files

| File | Purpose |
|------|---------|
| `src/domain/work-order/types.ts` | Core types: Goal, WorkItem, Run, Artifact |
| `src/domain/work-order/state-machine.ts` | Status transition rules |
| `src/infra/persistence/work-order-repository.ts` | SQLite implementation |
| `src/infra/llm/provider-manager/index.ts` | LLM provider manager with agent-based selection |
| `src/infra/llm/llm-service.ts` | LLM service with tier-based routing |
| `src/infra/config/credentials-loader.ts` | Credentials management (~/.ponybunny/credentials.json) |
| `src/infra/tools/tool-registry.ts` | Tool registration and allowlist |
| `src/infra/mcp/client/mcp-client.ts` | MCP client wrapper for external tools |
| `src/infra/mcp/client/connection-manager.ts` | MCP connection manager |
| `src/infra/mcp/config/mcp-config-loader.ts` | MCP configuration loader (~/.ponybunny/mcp-config.json) |
| `src/autonomy/react-integration.ts` | ReAct autonomous execution loop |
| `src/autonomy/daemon.ts` | Continuous operation engine |
| `src/cli/commands/service.ts` | Unified service management (start/stop/status/logs) |
| `src/cli/commands/scheduler-daemon.ts` | Scheduler background mode with PID management |
| `debug-server/server/src/api-server.ts` | Debug Server HTTP API and WebSocket |
| `debug-server/webui/` | Next.js-based Debug Dashboard |

## Layer Rules

- **Domain** never imports from `app/`, `infra/`, or `gateway/`
- **Scheduler** orchestrates domain + infra, defines interfaces (ports)
- **Gateway** handles all external communication (WS/WSS)
- **Infra** implements interfaces, handles external I/O
- Use `import type` for type-only imports
- Use named exports (avoid `export default`)

## Configuration System

PonyBunny uses multiple JSON config files in `~/.ponybunny/`:

### 1. `credentials.json` - API Keys (Sensitive)
```json
{
  "$schema": "./credentials.schema.json",
  "endpoints": {
    "anthropic-direct": {
      "enabled": true,
      "apiKey": "sk-ant-xxx"
    },
    "openai-direct": {
      "enabled": true,
      "apiKey": "sk-xxx"
    },
    "openai-compatible": {
      "enabled": false,
      "apiKey": "your-api-key",
      "baseUrl": "http://localhost:8000/v1"
    }
  }
}
```

### 2. `llm-config.json` - LLM Configuration
Defines endpoints, models, tiers, and agent-to-model mappings. See README.md for full schema.

**Key concepts:**
- **Endpoints**: Protocol + baseUrl + priority
- **Models**: Cost, capabilities, available endpoints
- **Tiers**: simple/medium/complex with primary + fallback chains
- **Agents**: Maps lifecycle phases to tiers or specific models

### 3. `mcp-config.json` - MCP Server Configuration
Defines Model Context Protocol server connections for external tools. See `docs/cli/MCP-INTEGRATION.md` for details.

**Key concepts:**
- **Transport**: stdio (local) or http (remote)
- **Allowed Tools**: Per-server tool filtering
- **Environment Variables**: Secure credential management with `${VAR}` expansion
- **Auto-reconnect**: Automatic reconnection on failure

Example:
```json
{
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "allowedTools": ["*"],
      "autoReconnect": true
    }
  }
}
```

## Testing Conventions

**Mock credentials in tests** to prevent loading from `~/.ponybunny/credentials.json`:
```typescript
jest.mock('../../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));
```

This prevents tests from using actual user credentials and ensures test isolation.

## Development Guidelines

### When Implementing New Features

1. **Determine component** - Is this Gateway (communication) or Scheduler (logic)?
2. **Check responsibility layer** - Autonomous, approval-required, or forbidden?
3. **Define verification plan** - How will completion be validated?
4. **Handle escalation paths** - What triggers escalation? What goes in the packet?
5. **Consider permissions** - Does this need OS-level access? Implement retry mechanism.

### When Adding Skills

1. **Define skill interface** - Input parameters, expected output
2. **Compose from tools** - Which atomic tools does it need?
3. **Handle failures** - Retry logic, fallback strategies
4. **Document permissions** - What OS services/permissions required?

### When Working with LLM Providers

**Use Provider Manager for agent-based selection:**
```typescript
import { getLLMProviderManager } from './src/infra/llm/provider-manager/index.js';

const manager = getLLMProviderManager();
const response = await manager.complete('execution', messages);
```

**Use LLMService for tier-based selection:**
```typescript
import { LLMService } from './src/infra/llm/llm-service.js';

const service = new LLMService();
const model = service.getModelForTier('complex'); // Returns primary or fallback
```

### Key Invariants

- Work Items form a DAG (no cycles)
- Status transitions follow state machine rules
- Budget cannot be exceeded without escalation
- Escalation Packets must be complete (context + attempts + analysis + options)
- Permission requests must have retry mechanism

## 8-Phase Autonomous Lifecycle

1. **Intake** - Validate goal requirements and constraints
2. **Elaboration** - Detect ambiguities, request clarification if needed
3. **Planning** - Decompose into work items (DAG structure)
4. **Execution** - Autonomous ReAct cycle with LLM
5. **Verification** - Run quality gates (tests, lint, build)
6. **Evaluation** - Decide: publish, retry, or escalate
7. **Publish** - Package artifacts and generate summary
8. **Monitor** - Track metrics and budget utilization

## Documentation

- `AGENTS.md` - Detailed development patterns and testing guidelines
- `docs/cli/` - CLI documentation and usage guides
  - `CLI-USAGE.md` - Complete CLI reference (985 lines)
  - `SCHEDULER-BACKGROUND-MODE.md` - Background mode implementation
  - `BUG-FIX-SERVICE-START-ALL.md` - Service command fixes
  - `BUG-FIX-DEBUG-SERVER-NOT-FOUND.md` - Debug server fixes
- `docs/techspec/` - Technical specifications and architecture design
  - `architecture-overview.md` - System architecture diagram and overview
  - `gateway-design.md` - WebSocket protocol, authentication, message routing
  - `scheduler-design.md` - Task orchestration, model selection, execution lanes
  - `ai-employee-paradigm.md` - Responsibility layers, escalation philosophy
- `docs/requirement/` - Product requirements documentation
- `docs/engineering/` - Reference materials (OpenClaw architecture)

## CLI Commands

### Service Management
```bash
pb service start all       # Start Gateway + Scheduler
pb service status          # Check all services
pb service stop all        # Stop all services
pb service logs <service>  # View logs (-f to follow)
```

### Gateway Management
```bash
pb gateway start           # Start in background (default)
pb gateway start --daemon  # Start with auto-restart
pb gateway stop            # Stop gracefully
pb gateway status          # Check status
pb gateway logs -f         # Follow logs
pb gateway pair            # Generate pairing token
```

### Scheduler Management
```bash
pb scheduler start         # Start in background (default)
pb scheduler start --foreground  # Run in foreground
pb scheduler stop          # Stop gracefully
pb scheduler status        # Check status and uptime
pb scheduler logs -f       # Follow logs
```

### Debug & Observability
```bash
pb debug web               # Launch Web UI (http://localhost:3001)
pb debug tui               # Launch Terminal UI
```

### Configuration Files

All configuration stored in `~/.ponybunny/`:
- `credentials.json` - API keys (sensitive)
- `llm-config.json` - LLM configuration
- `auth.json` - OAuth tokens
- `gateway.pid` - Gateway process info
- `scheduler.pid` - Scheduler process info
- `gateway.log` - Gateway logs
- `scheduler.log` - Scheduler logs
