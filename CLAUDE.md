# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PonyBunny is an **Autonomous AI Employee System** — a local-first CLI + server runtime where humans set goals and AI delivers results autonomously. Built on a **Gateway (WebSocket) + Scheduler (execution engine)** architecture with SQLite persistence and multi-LLM provider support (Anthropic, OpenAI, Gemini).

The CLI binary is `pb`. Config lives in `~/.config/ponybunny/` (legacy `~/.ponybunny/` auto-migrates).

## Build, Test & Run

```bash
# Build
npm run build              # Compile TypeScript to dist/ + copy assets
npm run build:cli          # Build CLI binary (pb command)
npm run build:all          # Both

# Test (Jest with ts-jest ESM)
npm test                   # All tests
npx jest test/path/to/file.test.ts  # Single test file
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report

# Module-specific tests
npm run test:cli           # CLI tests
npm run test:infra         # Infrastructure tests
npm run test:gateway       # Gateway tests
npm run test:scheduler     # Scheduler + daemon tests
npm run test:autonomy      # Autonomy tests
npm run test:domain        # Domain logic tests
npm run test:mcp           # MCP integration tests

# E2E tests (use tsx, NOT Jest)
npx tsx test/e2e-lifecycle.ts
npx tsx test/e2e/tool-calling-demo.ts

# Run
pb                         # Interactive TUI (connects to ws://127.0.0.1:18789)
pb service start all       # Start Gateway + Scheduler
pb service status          # Check services
pb service stop all        # Stop all
PONY_DB_PATH=./pony.db node dist/main.js  # Run daemon directly
```

## Architecture

```
CLI/TUI → Gateway (WebSocket) → Scheduler (Orchestration) → LLM Providers / Tools
                               → SQLite (Goals, Runs, Artifacts)
```

**Hexagonal Architecture** with strict layer rules:

| Layer | Path | Responsibility |
|-------|------|---------------|
| **Domain** | `src/domain/` | Pure business logic — types, state machine, skill definitions. **NEVER imports from app/infra/gateway/scheduler.** |
| **App** | `src/app/` | Application services, defines interfaces (ports) |
| **Infra** | `src/infra/` | Infrastructure adapters — SQLite, LLM providers, tools, MCP, config |
| **Gateway** | `src/gateway/` | WebSocket server, auth, connection management, message routing |
| **Scheduler** | `src/scheduler/` | Task orchestration, model/lane selection, 8-phase agent lifecycle |
| **Runtime** | `src/runtime/` | Execution engine — worker, tool, and conversation boundaries |
| **Autonomy** | `src/autonomy/` | ReAct loop integration, daemon mode |
| **CLI** | `src/cli/` | Commander.js commands + Ink (React) terminal UI |
| **IPC** | `src/ipc/` | Inter-process communication (Unix socket between Gateway and Scheduler) |

### 8-Phase Autonomous Lifecycle
Intake → Elaboration → Planning → Execution → Verification → Evaluation → Publish → Monitor

### Web Frontend
`web/` is a separate Next.js 16 app with Tailwind 4 + shadcn/ui. Has its own `package.json` and `node_modules`.

## Critical Code Conventions

### ESM imports MUST use `.js` extension
```typescript
import { Goal } from './types.js';           // ✅
import { Goal } from './types';              // ❌
```

### Naming
- Classes: `PascalCase` — Interfaces: `I`-prefix (`IWorkOrderRepository`)
- Files: `kebab-case` — DB fields: `snake_case`
- Functions: `camelCase` — Constants: `UPPER_SNAKE`

### Other rules
- **Dependency injection via constructor** — never instantiate dependencies inside services
- **Named exports** — avoid `export default`
- **`import type`** for type-only imports
- **State transitions must be validated** via state machine before updating
- **TypeScript**: target ES2022, strict mode, module ESNext

### Debug output
All debug `console` output **must** be gated by debug flag helpers from `src/infra/config/debug-flags.ts`:
```typescript
import { isPonyBunnyDebugEnabled } from '../infra/config/debug-flags.js';
if (isPonyBunnyDebugEnabled()) { console.log('[Module] ...'); }
```
Never read `process.env.PONY_BUNNY_DEBUG` directly in feature modules. Operational errors (`console.error`) must NOT be gated.

## Testing Conventions

**Mock credentials** to prevent loading real `~/.ponybunny/credentials.json`:
```typescript
jest.mock('../../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));
```

Jest uses `ts-jest` ESM preset. Module mapper converts `.js` → `.ts` for test resolution. Setup file: `test/jest-setup.ts`.

## Configuration Change Coupling (Mandatory)

When changing runtime config structure (add/remove/rename fields), **all three** must update in the same PR:
1. Schema: `docs/schemas/ponybunny.schema.json` + onboarding schema template
2. Example: `docs/config-templates/ponybunny.example.json`
3. `pb init` behavior + tests: `src/infra/config/onboarding.ts`

## Key Documentation

- Architecture: `docs/techspec/architecture-overview.md`
- Development patterns: `docs/development/AGENTS.md`
- CLI reference: `docs/cli/CLI-USAGE.md`
- MCP integration: `docs/mcp/README.md`
