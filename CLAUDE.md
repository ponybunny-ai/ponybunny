# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PonyBunny is an **Autonomous AI Employee System** that solves the **delegation bottleneck** in knowledge work. Built on a **Gateway + Scheduler** architecture where humans set goals and AI delivers complete results autonomously.

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
PONY_DB_PATH=./pony.db OPENAI_API_KEY=sk-... node dist/main.js

# CLI (after build:cli)
pb auth login
pb auth antigravity login
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
│   ├── persistence/  # SQLite repository
│   ├── llm/          # LLM providers with router failover
│   ├── tools/        # Tool registry & allowlist
│   └── skills/       # Skill implementations
├── autonomy/         # ReAct integration & daemon
└── cli/              # Commander.js CLI with Ink terminal UI
```

## Key Files

| File | Purpose |
|------|---------|
| `src/domain/work-order/types.ts` | Core types: Goal, WorkItem, Run, Artifact |
| `src/domain/work-order/state-machine.ts` | Status transition rules |
| `src/infra/persistence/work-order-repository.ts` | SQLite implementation |
| `src/infra/llm/llm-provider.ts` | LLM abstraction and router |
| `src/infra/tools/tool-registry.ts` | Tool registration and allowlist |
| `src/autonomy/react-integration.ts` | ReAct autonomous execution loop |
| `src/autonomy/daemon.ts` | Continuous operation engine |

## Layer Rules

- **Domain** never imports from `app/`, `infra/`, or `gateway/`
- **Scheduler** orchestrates domain + infra, defines interfaces (ports)
- **Gateway** handles all external communication (WS/WSS)
- **Infra** implements interfaces, handles external I/O
- Use `import type` for type-only imports
- Use named exports (avoid `export default`)

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

### Key Invariants

- Work Items form a DAG (no cycles)
- Status transitions follow state machine rules
- Budget cannot be exceeded without escalation
- Escalation Packets must be complete (context + attempts + analysis + options)
- Permission requests must have retry mechanism

## Documentation

- `AGENTS.md` - Detailed development patterns and testing guidelines
- `docs/techspec/` - Technical specifications and architecture design
  - `architecture-overview.md` - System architecture diagram and overview
  - `gateway-design.md` - WebSocket protocol, authentication, message routing
  - `scheduler-design.md` - Task orchestration, model selection, execution lanes
  - `ai-employee-paradigm.md` - Responsibility layers, escalation philosophy
- `docs/requirement/` - Product requirements documentation
- `docs/engineering/` - Reference materials (OpenClaw architecture)
