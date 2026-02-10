# AGENTS.md - PonyBunny Development Guide

**For AI coding agents working in this codebase.**

## Project Overview

PonyBunny is an **Autonomous AI Employee System** with **Gateway + Scheduler architecture**, local-first SQLite persistence, and multi-LLM provider support (Anthropic Claude, OpenAI GPT, Google Gemini). Built with TypeScript/Node.js following Hexagonal Architecture.

---

## Build, Test & Run Commands

### Build
```bash
npm run build              # Compile TypeScript to dist/
npm run build:cli          # Build CLI binary
```

### Test
```bash
npm test                   # Run all 779 tests
npm run test:watch         # Watch mode
npm run test:coverage      # Coverage report

# Single test file
npx jest test/cli/auth-manager.test.ts

# E2E tests (use tsx, not Jest)
npx tsx test/e2e-lifecycle.ts
npx tsx test/provider-manager-test.ts
```

### Run Services
```bash
pb service start all       # Start Gateway + Scheduler
pb service stop all        # Stop all services
pb service status          # Check status
pb service logs gateway -f # Follow logs

pb debug web               # Web UI (http://localhost:3001)
pb debug tui               # Terminal UI
```

---

## Architecture Layers

```
Gateway (WebSocket) → Scheduler (Orchestration) → LLM Provider Manager → Anthropic/OpenAI/Google
```

### Layer Rules
- **`src/domain/`** - Pure business logic, NO external dependencies, NO I/O
- **`src/gateway/`** - WebSocket server, auth, message routing
- **`src/scheduler/`** - Task orchestration, model selection, execution lanes
- **`src/app/`** - Application services, defines interfaces (ports)
- **`src/infra/`** - Infrastructure adapters (DB, LLM, tools, MCP)
- **`src/cli/`** - Commander.js CLI with Ink terminal UI

**Critical:** Domain NEVER imports from app/infra/gateway/scheduler

---

## Code Style Guidelines

### Import/Export (CRITICAL)
**Always use `.js` extension for ESM:**
```typescript
// ✅ CORRECT
import { Goal } from './types.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';

// ❌ WRONG
import { Goal } from './types';
```

- Use named exports (avoid `export default`)
- Use `import type` for type-only imports
- Barrel exports via `index.ts` for public APIs

### Naming Conventions
| Element | Convention | Example |
|---------|-----------|---------|
| Classes | PascalCase | `IntakeService`, `GatewayServer` |
| Interfaces | I-prefix | `IIntakeService`, `ILLMProvider` |
| Files | kebab-case | `state-machine.ts`, `gateway-server.ts` |
| DB Fields | snake_case | `goal_id`, `created_at` |
| Functions | camelCase | `acceptGoal()`, `startGateway()` |
| Constants | UPPER_SNAKE | `MAX_RETRIES`, `DEFAULT_PORT` |

### TypeScript
- Target: ES2022, Module: ESNext, Strict: true
- Prefer `interface` for objects, `type` for unions
- Mark optional fields with `?`
- Never use empty catch blocks

### Dependency Injection
**Always inject via constructor:**
```typescript
// ✅ CORRECT
export class IntakeService {
  constructor(private repository: IWorkOrderRepository) {}
}

// ❌ WRONG
export class IntakeService {
  acceptGoal() {
    const db = new WorkOrderDatabase(); // BAD!
  }
}
```

---

## Testing Patterns

### Mock Credentials (CRITICAL)
**Prevent loading from `~/.ponybunny/credentials.json`:**
```typescript
jest.mock('../../../src/infra/config/credentials-loader.js', () => ({
  getCachedEndpointCredential: jest.fn(() => null),
  clearCredentialsCache: jest.fn(),
}));
```

### Test Structure
```typescript
describe('Service', () => {
  let service: Service;
  let mockDep: jest.Mocked<IDependency>;

  beforeEach(() => {
    mockDep = { method: jest.fn() } as any;
    service = new Service(mockDep);
  });

  test('should work', async () => {
    mockDep.method.mockReturnValue('result');
    expect(await service.doThing()).toBe('result');
  });
});
```

---

## Common Gotchas

### State Transitions
**Always validate before updating:**
```typescript
// ✅ CORRECT
if (canTransitionWorkItem(item.status, 'in_progress')) {
  repository.updateWorkItemStatus(item.id, 'in_progress');
}

// ❌ WRONG
repository.updateWorkItemStatus(item.id, 'in_progress'); // Unchecked!
```

### LLM Provider Usage
```typescript
// Agent-based selection
import { getLLMProviderManager } from './src/infra/llm/provider-manager/index.js';
const manager = getLLMProviderManager();
const response = await manager.complete('execution', messages);

// Tier-based selection
import { LLMService } from './src/infra/llm/llm-service.js';
const service = new LLMService();
const model = service.getModelForTier('complex');
```

### Configuration Files
All in `~/.ponybunny/`:
- `credentials.json` - API keys (sensitive, never commit)
- `llm-config.json` - LLM endpoints, models, tiers, agents
- `mcp-config.json` - Model Context Protocol servers
- `gateway.pid`, `scheduler.pid` - Process info

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/domain/work-order/types.ts` | Core types (Goal, WorkItem, Run, Artifact) |
| `src/domain/work-order/state-machine.ts` | Status transition rules |
| `src/gateway/gateway-server.ts` | WebSocket server |
| `src/scheduler/agent/` | 8-phase lifecycle agents |
| `src/infra/llm/provider-manager/` | LLM provider manager |
| `src/infra/mcp/client/` | MCP client for external tools |
| `src/infra/persistence/work-order-repository.ts` | SQLite repository |
| `src/cli/commands/service.ts` | Unified service management |

---

**Last Updated:** 2026-02-10 - For AI coding agents working in PonyBunny codebase.
