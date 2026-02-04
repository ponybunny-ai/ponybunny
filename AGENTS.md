# AGENTS.md - PonyBunny Development Guide

**For AI coding agents working in this codebase.**

## Project Overview

PonyBunny is an **Autonomous AI Employee System** built with **TypeScript** and **Node.js** following **Hexagonal Architecture** (Ports & Adapters). It implements an 8-phase autonomous execution lifecycle for managing AI-driven work orders with local-first SQLite persistence and multi-LLM provider support (OpenAI, Anthropic).

**Key Characteristics:**
- Production-ready hexagonal architecture with strict layer separation
- Local-first, security-first, durable execution model
- ReAct (Reasoning + Action) cycle for autonomous operation
- Work orders modeled as DAGs (Directed Acyclic Graphs)

---

## Build, Test & Run Commands

### Build
```bash
npm run build              # Compile TypeScript to dist/
npm run build:cli          # Build CLI binary at dist/cli/index.js
```

### Test
```bash
npm test                   # Run all Jest tests
npm run test:watch         # Run Jest in watch mode
npm run test:coverage      # Generate coverage report

# Run a single test file
npx jest test/cli/auth-manager.test.ts

# Run E2E integration tests
npx tsx test/e2e-lifecycle.ts

# Run demo scripts
npx tsx demo/autonomous-demo.ts
```

### Run
```bash
# Start autonomous daemon
PONY_DB_PATH=./pony.db OPENAI_API_KEY=sk-... node dist/main.js

# CLI commands
npx tsx src/cli/index.ts auth login
npb pb                     # After build:cli, runs the CLI
```

---

## Architecture: Hexagonal Layers

The codebase is organized into **three strict layers**:

### 1. `src/domain/` - Pure Business Logic
**No external dependencies. No I/O. Pure functions and rules.**

- **`domain/work-order/types.ts`** - Core type definitions (Goal, WorkItem, Run, etc.)
- **`domain/work-order/state-machine.ts`** - Status transition rules for Goals, WorkItems, and Runs
- **`domain/work-order/invariants.ts`** - Validation rules (DAG integrity, budget conservation)

**Rules:**
- Domain layer NEVER imports from `app/` or `infra/`
- All types are exported via `domain/types.ts`
- State transitions are explicit and validated via `canTransitionGoal()`, `canTransitionWorkItem()`, etc.

### 2. `src/app/` - Application Services (8-Phase Lifecycle)
**Orchestrates domain logic with infrastructure. Defines ports (interfaces).**

```
app/lifecycle/
├── intake/        # Phase 1: Validate goal requirements
├── elaboration/   # Phase 2: Detect ambiguities, escalate
├── planning/      # Phase 3: Break down into work items (DAG)
├── execution/     # Phase 4: ReAct cycle with LLM
├── verification/  # Phase 5: Run quality gates
├── evaluation/    # Phase 6: Decide: publish, retry, escalate
├── publish/       # Phase 7: Package artifacts & summary
└── monitor/       # Phase 8: Health metrics & budget tracking
```

**Patterns:**
- Each stage has an `I{Stage}Service` interface in `app/lifecycle/stage-interfaces.ts`
- Services receive dependencies via constructor (Dependency Injection)
- Return typed results (`IntakeResult`, `PlanningResult`, etc.)

### 3. `src/infra/` - Infrastructure Adapters
**External concerns: databases, LLMs, tool execution.**

- **`infra/persistence/`** - SQLite repository implementing `IWorkOrderRepository`
- **`infra/llm/`** - LLM provider abstraction (`ILLMProvider`) with OpenAI/Anthropic implementations
- **`infra/tools/`** - Tool registry & allowlist enforcement

**Rules:**
- Implements interfaces defined by `app/` layer
- All database queries live here, not in domain/app
- LLM providers use Strategy Pattern with router-based failover

### 4. `src/autonomy/` - ReAct Integration
**The autonomous execution engine.**

- **`autonomy/react-integration.ts`** - Observation → Thought → Action loop
- **`autonomy/daemon.ts`** - Continuous operation daemon

---

## Code Style Guidelines

### TypeScript Configuration
- **Target:** ES2022
- **Module:** ESNext (ES Modules)
- **Strict Mode:** Enabled (all strict checks on)
- **JSX:** React (for CLI terminal UI via Ink)

### Import/Export Patterns
**CRITICAL:** Always use `.js` extension in imports (required for ESM):

```typescript
// ✅ CORRECT
import { Goal } from './types.js';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface.js';

// ❌ WRONG
import { Goal } from './types';
import type { IWorkOrderRepository } from '../../infra/persistence/repository-interface';
```

- Use named exports (avoid `export default`)
- Barrel exports via `index.ts` for public APIs
- Use `import type` for type-only imports

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| **Classes** | PascalCase | `IntakeService`, `WorkOrderDatabase` |
| **Interfaces** | I-prefix PascalCase | `IIntakeService`, `ILLMProvider` |
| **Files** | kebab-case | `state-machine.ts`, `work-order-repository.ts` |
| **Database Fields** | snake_case | `goal_id`, `created_at`, `spent_tokens` |
| **Functions** | camelCase | `acceptGoal()`, `canTransitionWorkItem()` |
| **Constants** | UPPER_SNAKE_CASE | `GOAL_TRANSITIONS`, `MAX_RETRIES` |

### Type Usage
- Prefer `interface` for object shapes
- Use `type` for unions, intersections, and aliases
- Use `Partial<T>` for request/update objects
- Mark optional fields with `?` in interfaces

```typescript
// ✅ CORRECT
interface Goal {
  id: string;
  title: string;
  budget_tokens?: number;  // Optional
}

type GoalStatus = 'queued' | 'active' | 'blocked' | 'completed' | 'cancelled';
```

### Error Handling
- Domain layer: Return `InvariantViolation[]` arrays for validation errors
- App layer: Aggregate violations and throw single `Error` with combined message
- Infra layer: Throw specific error classes (`LLMProviderError`, etc.)
- Never use empty catch blocks

```typescript
// ✅ CORRECT
const violations = validateGoalInvariants(goal);
if (violations.length > 0) {
  throw new Error(`Goal validation failed: ${violations.map(v => v.message).join(', ')}`);
}

// ❌ WRONG
try {
  doSomething();
} catch (e) {}
```

### Dependency Injection Pattern
**Always inject dependencies via constructor:**

```typescript
// ✅ CORRECT
export class IntakeService implements IIntakeService {
  constructor(private repository: IWorkOrderRepository) {}

  async acceptGoal(request: GoalRequest): Promise<IntakeResult> {
    const goal = this.repository.createGoal({ ... });
    return { goal, needsElaboration: false };
  }
}

// ❌ WRONG - Don't instantiate dependencies inside
export class IntakeService {
  async acceptGoal(request: GoalRequest): Promise<IntakeResult> {
    const db = new WorkOrderDatabase('./pony.db'); // BAD!
  }
}
```

---

## Testing Patterns

### Jest Configuration
- **Framework:** Jest with `ts-jest`
- **Environment:** Node.js
- **Module System:** ESM (ES Modules)
- **Test Location:** `test/**/*.test.ts`
- **Coverage Output:** `coverage/`

### Test Structure
```typescript
describe('IntakeService', () => {
  let service: IntakeService;
  let mockRepo: jest.Mocked<IWorkOrderRepository>;

  beforeEach(() => {
    mockRepo = {
      createGoal: jest.fn(),
      // ... other methods
    } as any;
    service = new IntakeService(mockRepo);
  });

  test('should accept valid goal', async () => {
    mockRepo.createGoal.mockReturnValue({ id: 'test-id', ... });
    const result = await service.acceptGoal({ ... });
    expect(result.goal.id).toBe('test-id');
  });
});
```

### Mocking Patterns
- Use `jest.mock()` for module-level mocks
- Mock global `fetch` for API clients
- Use temporary directories (`tmpdir()`) for file-based tests
- Clean up in `afterEach`

### E2E Tests
- Located in `test/e2e-lifecycle.ts` or `demo/` directory
- Run via `npx tsx` (not Jest)
- Use real service instances with test database
- Example: `npx tsx test/e2e-lifecycle.ts`

---

## Common Gotchas & Rules

### State Transitions
**Never update status directly. Always validate transitions:**

```typescript
// ✅ CORRECT
if (canTransitionWorkItem(item.status, 'in_progress')) {
  repository.updateWorkItemStatus(item.id, 'in_progress');
}

// ❌ WRONG
repository.updateWorkItemStatus(item.id, 'in_progress'); // Unchecked!
```

### Database Patterns
- All DB operations return parsed objects (not raw rows)
- Use `JSON.stringify()` for complex fields (arrays, objects)
- Timestamps are Unix milliseconds (`Date.now()`)
- UUIDs via `randomUUID()` from `node:crypto`

### LLM Provider Usage
- Use `LLMRouter` for automatic failover
- Always pass `maxTokens` configuration
- Handle provider-specific errors gracefully

---

## File Organization Checklist

When creating new features, follow this structure:

1. **Domain types** → `src/domain/{feature}/types.ts`
2. **Domain rules** → `src/domain/{feature}/invariants.ts` or `state-machine.ts`
3. **App interface** → `src/app/lifecycle/stage-interfaces.ts`
4. **App service** → `src/app/lifecycle/{stage}/{stage}-service.ts`
5. **Infra adapter** → `src/infra/{adapter}/...`
6. **Tests** → `test/{feature}/{file}.test.ts`

---

## Quick Reference: Key Files

| File | Purpose |
|------|---------|
| `src/domain/work-order/types.ts` | Core type definitions (Goal, WorkItem, Run) |
| `src/domain/work-order/state-machine.ts` | Status transition rules |
| `src/app/lifecycle/stage-interfaces.ts` | Service interfaces for all 8 phases |
| `src/infra/persistence/work-order-repository.ts` | SQLite database implementation |
| `src/infra/llm/llm-provider.ts` | LLM abstraction and router |
| `src/autonomy/react-integration.ts` | ReAct autonomous execution loop |
| `package.json` | Build/test scripts and dependencies |
| `jest.config.js` | Test configuration |

---

**Last Updated:** Generated for AI coding agents working in PonyBunny codebase.
