# PonyBunny

Durable like a pony. Fast like a bunny. Local-first, security-first, and trim-to-fit — know your AI agent like you know your staff.

## Paradigm: AI as Autonomous Employee

PonyBunny transforms AI from a passive assistant into an **autonomous employee** that receives goals and independently completes them through planning, execution, verification, and error recovery—with minimal human intervention.

### Core Architecture

**Work Order System** - Structured autonomous task management with:
- **Goals**: High-level objectives with success criteria and budgets
- **Work Items**: Granular executable tasks in a dependency DAG
- **Runs**: Execution records with artifacts and error signatures
- **Decisions**: Agent reasoning logs (why X over Y)
- **Escalations**: Human intervention requests with clear policies
- **Context Packs**: Multi-day state persistence

**Autonomy Daemon** - Continuous loop that:
1. Selects ready work items (respecting dependencies)
2. Executes ReAct cycle with quality gates
3. Handles errors with retry logic and pattern detection
4. Escalates to human only when stuck (not on every decision)
5. Updates goal progress and unblocks dependent work

**Quality Gates** - Verification before completion:
- **Deterministic** (tests, lint, build) - must pass
- **LLM Review** (code smell, security) - secondary validation
- **Rule**: LLM cannot override failing deterministic gates

## Project Structure

```
pony/
├── docs/
│   ├── requirement/        # Requirements & specifications
│   │   ├── work-order-system.md  # Core autonomous architecture
│   │   ├── overview.md           # Paradigm shift documentation
│   │   └── ...
│   └── engineering/        # Implementation guides
├── src/
│   ├── work-order/
│   │   ├── database/
│   │   │   ├── schema.sql        # SQLite schema (8 tables)
│   │   │   └── manager.ts        # Database access layer
│   │   └── types/
│   │       └── index.ts          # TypeScript type definitions
│   ├── autonomy/
│   │   ├── daemon.ts             # Autonomy Daemon main loop
│   │   └── react-integration.ts # ReAct cycle implementation
│   ├── index.ts                  # Public API exports
│   └── main.ts                   # Daemon entry point
└── package.json
```

## Quick Start

Any application that can be written in JavaScript, will eventually be written in JavaScript.

### Installation

```bash
npm install
npm run build
```

### Initialize Database

The database is auto-initialized on first run. Schema includes:
- `goals` - High-level objectives
- `work_items` - Executable tasks
- `runs` - Execution logs
- `artifacts` - Generated outputs
- `decisions` - Reasoning logs
- `escalations` - Human intervention requests
- `context_packs` - Multi-day state snapshots
- `meta` - Schema versioning

### Start Autonomy Daemon

```bash
PONY_DB_PATH=./pony.db node dist/main.js
```

### Create a Goal (via API)

```typescript
import { WorkOrderDatabase } from 'pony';

const db = new WorkOrderDatabase('./pony.db');
await db.initialize();

const goal = db.createGoal({
  title: 'Implement user authentication',
  description: 'Add JWT-based authentication with login/logout endpoints',
  success_criteria: [
    {
      description: 'Tests pass',
      type: 'deterministic',
      verification_method: 'npm test',
      required: true,
    },
    {
      description: 'Lint clean',
      type: 'deterministic',
      verification_method: 'npm run lint',
      required: true,
    },
  ],
  budget_tokens: 100000,
  budget_time_minutes: 120,
  priority: 80,
});

const workItem1 = db.createWorkItem({
  goal_id: goal.id,
  title: 'Create auth service module',
  description: 'Implement JWT token generation and validation',
  item_type: 'code',
  estimated_effort: 'M',
  priority: 90,
});

const workItem2 = db.createWorkItem({
  goal_id: goal.id,
  title: 'Write auth service tests',
  description: 'Unit tests for JWT service',
  item_type: 'test',
  estimated_effort: 'S',
  dependencies: [workItem1.id],
  priority: 80,
});

db.updateGoalStatus(goal.id, 'active');
db.updateWorkItemStatus(workItem1.id, 'ready');
```

## Success Metrics

- **Autonomous Completion Rate**: >70% of work items completed without human intervention
- **Continuous Operation**: ≥8 hour work shifts without human input
- **Quality**: >80% first-time Quality Gate pass rate
- **Multi-day Success**: >60% of multi-day projects completed autonomously

## Development Roadmap

### Week 1-2: MVP
- ✅ Database schema & access layer
- ✅ Autonomy Daemon core loop
- ✅ ReAct integration skeleton
- ⏳ LLM integration (OpenAI/Anthropic)
- ⏳ Basic quality gates (shell command execution)

### Week 3-4: Quality & Escalation
- ⏳ Verification plan execution
- ⏳ Error signature detection
- ⏳ Escalation packet generation
- ⏳ Dependency DAG resolution

### Week 5-8: Multi-day Persistence
- ⏳ Context pack generation
- ⏳ Daily rollup summaries
- ⏳ Long-running project support
- ⏳ Human escalation UI

## License

ISC

---

**Status**: Foundation implemented. Next: LLM integration + Quality gate execution.
