# PonyBunny - Autonomous AI Employee System

**Production-ready hexagonal architecture for autonomous AI agents.**

Durable like a pony. Fast like a bunny. Local-first, security-first, and trim-to-fit — know your AI agent like you know your staff.

## Architecture

PonyBunny follows **hexagonal architecture** (ports & adapters) with three distinct layers:

```
src/
├── domain/           # Business logic & rules
│   └── work-order/
│       ├── types.ts          # Core type definitions
│       ├── state-machine.ts  # Status transition rules
│       └── invariants.ts     # DAG validation, budget conservation
│
├── app/              # Application services
│   └── lifecycle/
│       ├── intake/           # Stage 1: Goal validation
│       ├── elaboration/      # Stage 2: Clarification & escalation
│       ├── planning/         # Stage 3: Work item DAG creation
│       ├── execution/        # Stage 4: ReAct cycle
│       ├── verification/     # Stage 5: Quality gates
│       ├── evaluation/       # Stage 6: Publish/retry/escalate
│       ├── publish/          # Stage 7: Artifact packaging
│       └── monitor/          # Stage 8: Health metrics
│
└── infra/            # Infrastructure
    ├── persistence/          # SQLite repository
    ├── llm/                  # LLM provider abstraction
    │   ├── llm-provider.ts  # Interface + Router
    │   └── providers.ts     # OpenAI, Anthropic
    └── tools/                # Tool registry + allowlist
```

## Core Concepts

### Work Order System

PonyBunny implements an **8-phase autonomous execution lifecycle**:

1. **Intake** - Validate goal requirements
2. **Elaboration** - Detect ambiguities, escalate if needed
3. **Planning** - Break down into work items (DAG)
4. **Execution** - Autonomous ReAct cycle with LLM
5. **Verification** - Run quality gates (tests, lint, build)
6. **Evaluation** - Decide: publish, retry, or escalate
7. **Publish** - Package artifacts & generate summary
8. **Monitor** - Track metrics & budget utilization

### Entity Model

```typescript
Goal
├── success_criteria[]      // Deterministic + heuristic
├── budget_tokens/time/cost // Resource limits
└── WorkItem[]
    ├── verification_plan   // Quality gates
    ├── dependencies[]      // DAG structure
    └── Run[]
        ├── artifacts[]     // Generated outputs
        ├── decisions[]     // Agent reasoning
        └── escalations[]   // Human intervention requests
```

## Quick Start

### Installation

```bash
npm install
npm run build
```

### Run Demo

```bash
# Without LLM (mock mode)
npx tsx demo/autonomous-demo.ts

# With real LLM
OPENAI_API_KEY=sk-... npx tsx demo/autonomous-demo.ts
# or
ANTHROPIC_API_KEY=sk-... npx tsx demo/autonomous-demo.ts
```

### Start Autonomous Daemon

```bash
PONY_DB_PATH=./pony.db \
OPENAI_API_KEY=sk-... \
node dist/main.js
```

## Usage Example

```typescript
import { WorkOrderDatabase } from 'pony';
import { IntakeService } from 'pony/app/lifecycle/intake';
import { OpenAIProvider } from 'pony/infra/llm/providers';

const db = new WorkOrderDatabase('./pony.db');
await db.initialize();

const llm = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
});

const intake = new IntakeService(db);

const result = await intake.acceptGoal({
  title: 'Implement user authentication',
  description: 'Add JWT-based auth with login/logout',
  success_criteria: [
    {
      description: 'Tests pass',
      type: 'deterministic',
      verification_method: 'npm test',
      required: true,
    },
  ],
  budget_tokens: 100000,
  priority: 80,
});

console.log(`Goal created: ${result.goal.id}`);
```

## LLM Provider Configuration

PonyBunny supports multiple LLM providers with automatic failover:

```typescript
import { LLMRouter } from 'pony/infra/llm/llm-provider';
import { OpenAIProvider, AnthropicProvider } from 'pony/infra/llm/providers';

const router = new LLMRouter([
  new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o',
    maxTokens: 4000,
  }),
  new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 4000,
  }),
]);

// Router automatically fails over if primary provider is down
const response = await router.complete([
  { role: 'system', content: 'You are a helpful assistant' },
  { role: 'user', content: 'Hello!' },
]);
```

## Tool Registry & Security

Control what actions the AI can perform:

```typescript
import { ToolRegistry, ToolAllowlist, ToolEnforcer } from 'pony/infra/tools/tool-registry';

const registry = new ToolRegistry();
const allowlist = new ToolAllowlist([
  'read_file',
  'write_file',
  'git_commit',
]);

const enforcer = new ToolEnforcer(registry, allowlist);

const check = enforcer.canExecute('git_push');
if (!check.allowed) {
  console.log(`Blocked: ${check.reason}`);
}
```

## Quality Gates

Define verification requirements for work items:

```typescript
const workItem = db.createWorkItem({
  goal_id: goal.id,
  title: 'Add login endpoint',
  verification_plan: {
    quality_gates: [
      {
        name: 'Unit Tests',
        type: 'deterministic',
        command: 'npm test',
        expected_exit_code: 0,
        required: true,
      },
      {
        name: 'Type Check',
        type: 'deterministic',
        command: 'tsc --noEmit',
        expected_exit_code: 0,
        required: true,
      },
      {
        name: 'Code Review',
        type: 'llm_review',
        review_prompt: 'Check for security vulnerabilities',
        required: false,
      },
    ],
    acceptance_criteria: [
      'Handles invalid credentials',
      'Returns JWT token on success',
    ],
  },
});
```

## Development

### Project Structure

- **`src/domain/`** - Pure business logic, no dependencies
- **`src/app/`** - Application services orchestrating domain + infra
- **`src/infra/`** - External concerns (DB, LLM, tools)
- **`src/autonomy/`** - ReAct integration & daemon

### Running Tests

```bash
npm test                    # All tests
npx tsx test/e2e-lifecycle.ts   # E2E lifecycle test
npx tsx demo/autonomous-demo.ts # Full autonomous demo
```

### Key Design Decisions

1. **Dependency Injection** - All services accept dependencies via constructor
2. **Interface Segregation** - Each lifecycle stage has its own service interface
3. **Repository Pattern** - Database abstraction via `IWorkOrderRepository`
4. **Strategy Pattern** - LLM providers implement `ILLMProvider`
5. **State Machine** - Explicit transition rules enforced at domain layer

## Success Metrics

- **Autonomous Completion Rate**: >70% of work items without human intervention
- **Continuous Operation**: ≥8 hour work shifts without human input
- **Quality**: >80% first-time Quality Gate pass rate
- **Multi-day Success**: >60% of multi-day projects completed autonomously

## Roadmap

- [x] Hexagonal architecture foundation
- [x] 8-phase lifecycle services
- [x] LLM provider abstraction (OpenAI, Anthropic)
- [x] Tool registry + allowlist enforcement
- [x] ReAct integration
- [x] Quality gate execution
- [ ] Context pack generation (multi-day persistence)
- [ ] Sandbox executor (Docker isolation)
- [ ] Idempotency store for tool invocations
- [ ] Web UI for escalation management
- [ ] Metrics dashboard

## License

ISC

---

**Status**: Production-ready architecture. ReAct cycle functional with real LLMs. Ready for autonomous operation.
