# 02 - Architecture

## 2.1 Hexagonal Architecture

PonyBunny follows a strict hexagonal (ports and adapters) architecture. Each layer has explicit dependency rules.

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI / TUI Layer                           │
│  src/cli/          Commander.js + Ink React terminal UI          │
├──────────────────────────────────────────────────────────────────┤
│                      Gateway Layer                               │
│  src/gateway/      WebSocket server, auth, RPC, event broadcast  │
├──────────────────┬───────────────────────────────────────────────┤
│  IPC Layer       │           Scheduler Layer                     │
│  src/ipc/        │  src/scheduler/   Orchestration, lanes,       │
│  Unix socket     │                   model selection, budget     │
├──────────────────┴───────────────────────────────────────────────┤
│                      Harness Layer (ADR-001)                     │
│  src/harness/      GoalHarness, HarnessDaemon, PostGoalEvaluator│
├──────────────────────────────────────────────────────────────────┤
│                      Runtime Layer                               │
│  src/runtime/      Execution boundary, tool boundary, workers    │
├──────────────────────────────────────────────────────────────────┤
│                    Application Layer                              │
│  src/app/          Services, lifecycle phases, interfaces (ports) │
├──────────────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                            │
│  src/infra/        SQLite, LLM providers, tools, MCP, config     │
├──────────────────────────────────────────────────────────────────┤
│                      Domain Layer                                │
│  src/domain/       Pure business logic, types, state machine     │
│                    *** NO EXTERNAL DEPENDENCIES ***              │
└──────────────────────────────────────────────────────────────────┘
```

## 2.2 Layer Dependency Rules

| Layer | Can Import From | Cannot Import From |
|-------|----------------|-------------------|
| **Domain** (`src/domain/`) | Nothing (pure) | app, infra, gateway, scheduler, harness, runtime, cli |
| **App** (`src/app/`) | domain | infra, gateway, scheduler, harness, runtime, cli |
| **Infra** (`src/infra/`) | domain, app | gateway, scheduler, harness, cli |
| **Runtime** (`src/runtime/`) | domain, app, infra | gateway, harness, cli |
| **Harness** (`src/harness/`) | domain, app, infra, scheduler | gateway, cli |
| **Scheduler** (`src/scheduler/`) | domain, app, infra, runtime | gateway, harness, cli |
| **Gateway** (`src/gateway/`) | domain, app, infra, scheduler, harness, runtime, ipc | cli |
| **CLI** (`src/cli/`) | All layers | — |
| **IPC** (`src/ipc/`) | Nothing (protocol-only) | All layers |

**Critical invariant**: Domain NEVER imports from any other layer.

**ADR-001 invariant**: GoalHarness imports from scheduler (via `ISchedulerCore` interface) but SchedulerCore NEVER imports from harness. Composition flows one direction only.

## 2.3 Source Directory Structure

```
src/
├── harness/                   # ADR-001 composition layer
│   ├── goal-harness-interface.ts  # IGoalHarness contract
│   ├── goal-harness.ts        #   Elaborate → plan → delegate
│   ├── harness-daemon.ts      #   Polling loop with concurrency gating
│   ├── post-goal-evaluator.ts #   Phase 5: observational post-goal evaluation
│   └── index.ts               #   Barrel exports
│
├── domain/                    # Pure business logic
│   ├── work-order/            #   State machine, invariants, result DTOs
│   ├── conversation/          #   Conversation state machine, persona, session
│   ├── escalation/            #   Escalation packet types
│   ├── permission/            #   Responsibility layers, tool permissions
│   ├── knowledge/             #   GlobalKnowledgeService (cross-goal learning)
│   ├── skill/                 #   Skill metadata types
│   ├── abort/                 #   Abort signal management
│   ├── audit/                 #   Audit trail types
│   ├── clarify/               #   Goal clarification workflow
│   └── stuck/                 #   Stuck detection types
│
├── app/                       # Application services (ports)
│   ├── lifecycle/             #   8-phase lifecycle services
│   │   ├── elaboration/       #     ElaborationService
│   │   ├── planning/          #     PlanningService
│   │   ├── execution/         #     ExecutionService
│   │   ├── evaluation/        #     EvaluationService
│   │   └── stage-interfaces.ts #    Shared lifecycle interfaces
│   ├── conversation/          #   Session, persona, memory, response services
│   ├── escalation/            #   Escalation routing
│   ├── execution/             #   ReAct execution service
│   └── monitoring/            #   Stuck detection service
│
├── infra/                     # Infrastructure adapters
│   ├── persistence/           #   SQLite repositories (work-order, audit, permission, session, memory)
│   ├── llm/                   #   LLM providers, protocol adapters, routing, provider manager
│   ├── tools/                 #   Tool registry, execution, allowlist
│   ├── mcp/                   #   MCP client, config, tool/resource adapters
│   ├── config/                #   Credentials, LLM config, debug flags, onboarding
│   ├── agents/                #   Agent provider interfaces
│   ├── prompts/               #   System prompt builder, templates
│   ├── skills/                #   Skill registry, loading
│   ├── audit/                 #   Audit logging service
│   ├── permission/            #   Permission checking service
│   ├── routing/               #   Tool routing
│   ├── conversation/          #   Conversation repository
│   ├── scheduler/             #   Scheduler interfaces
│   └── ui/                    #   Terminal UI utilities
│
├── gateway/                   # WebSocket server
│   ├── auth/                  #   Auth manager, challenge, signature, token store
│   ├── protocol/              #   Message router, parser
│   ├── rpc/                   #   RPC handler, method registry, 17+ handler modules
│   ├── connection/            #   Connection manager, session, heartbeat
│   ├── events/                #   Event bus, emitter, broadcast manager
│   ├── integration/           #   IPC bridge, scheduler bridge
│   ├── channels/              #   Channel routing, adapters
│   ├── bootstrap/             #   Gateway lifecycle management
│   ├── config/                #   Config watcher
│   ├── runtime/               #   Tool runtime, rollout coordination
│   ├── system/                #   System components
│   └── utils/                 #   Network utilities
│
├── scheduler/                 # Task orchestration
│   ├── core/                  #   SchedulerCore engine
│   ├── lane-selector/         #   Execution lane assignment
│   ├── model-selector/        #   LLM model selection with complexity scoring
│   ├── budget-tracker/        #   Multi-dimensional budget tracking
│   ├── retry-handler/         #   Error recovery and retry decisions
│   ├── quality-gate-runner/   #   Post-execution verification
│   ├── work-item-manager/     #   DAG validation, dependency resolution
│   ├── escalation-handler/    #   Escalation creation and management
│   └── composition/           #   Default scheduler factory
│
├── runtime/                   # Execution engine
│   ├── execution-boundary/    #   ExecutionPort interface, local adapter
│   ├── tool-boundary/         #   ToolPort interface, local adapter
│   ├── conversation-boundary/ #   ConversationPort interface
│   ├── event-bus/             #   Memory event bus, runtime events
│   ├── workers/               #   LocalExecutionWorker
│   └── tooling-context/       #   Tool context management
│
├── autonomy/                  # Legacy (AutonomyDaemon removed in Phase 4)
│   ├── react-integration.ts   #   ReAct (Reasoning+Acting) loop
│   └── daemon-event-emitter.ts #  Legacy event emitter
│
├── scheduler-daemon/          # Daemon process bootstrap
│   ├── bootstrap/             #   Default daemon runtime factory + assembly functions
│   └── conversation-bootstrap/ #  Conversation infrastructure setup
│
├── ipc/                       # Inter-process communication
│   ├── ipc-server.ts          #   Gateway-side IPC server
│   ├── ipc-client.ts          #   Daemon-side IPC client
│   └── types.ts               #   IPC message protocol types
│
├── cli/                       # CLI and terminal UI
│   ├── commands/              #   18 CLI command modules
│   ├── tui/                   #   Ink React components, store, hooks
│   ├── ui/                    #   Terminal formatting utilities
│   └── index.ts               #   CLI entry point
│
├── work-order/                # Core domain types (shared)
│   ├── types/index.ts         #   Goal, WorkItem, Run, Artifact, etc.
│   └── database/              #   Database operation types
│
├── debug/                     # Debug event types
├── main.ts                    # Daemon entry point (HarnessDaemon bootstrap)
└── public.ts                  # Package public surface exports
```

## 2.4 Data Flow: Goal Submission to Completion (ADR-001)

```
User submits goal via TUI/API
         │
         ▼
┌─ Gateway ─────────────────────────────────────────────┐
│  1. WebSocket receives RPC: goal.submit               │
│  2. Validates params, creates Goal in DB              │
│  3. Forwards to Scheduler via IPC: submit_goal        │
│  4. Returns Goal to client                            │
│  5. Broadcasts event: goal.created                    │
└────────────────────────────┬──────────────────────────┘
                             │ IPC
┌─ GoalHarness ──────────────▼──────────────────────────┐
│  6. processQueuedGoal() or submitGoal():              │
│     a. Elaborate — inject GlobalKnowledge pitfalls    │
│     b. Check escalations — block if any               │
│     c. Plan — generate WorkItem DAG via LLM           │
│     d. Mark goal active                               │
│     e. Delegate to SchedulerCore                      │
└────────────────────────────┬──────────────────────────┘
                             │
┌─ SchedulerCore ────────────▼──────────────────────────┐
│  7. Tick loop processes goal:                         │
│     a. Check escalations, budget                      │
│     b. Get next ready work item (DAG ordering)        │
│     c. Select lane (main/subagent/cron/session)       │
│     d. Select model (complexity scoring → tier)       │
│     e. Create Run record                              │
│     f. Dispatch execution                             │
│  8. Execution (ReAct loop):                           │
│     a. Generate system prompt                         │
│     b. Call LLM with tool definitions                 │
│     c. Execute tool calls                             │
│     d. Iterate until task complete (max 20 iters)     │
│  9. Post-execution:                                   │
│     a. Run quality gates (verification)               │
│     b. Update work item status                        │
│     c. Record budget usage                            │
│     d. Check for retry/escalation if failed           │
│  10. If all work items done → complete goal           │
│  11. Emit goal_completed or goal_failed event         │
└────────────────────────────┬──────────────────────────┘
                             │ event subscription
┌─ PostGoalEvaluator ────────▼──────────────────────────┐
│  12. Receives goal_completed / goal_failed            │
│  13. Evaluates each work item's final run             │
│  14. Produces GoalEvaluationReport (observational)    │
│  15. Logs unactionable decisions (e.g., replan)       │
└────────────────────────────┬──────────────────────────┘
                             │ IPC events
┌─ Gateway ──────────────────▼──────────────────────────┐
│  16. Broadcasts events to subscribed clients:         │
│      work_item_started, run_started, run_completed,   │
│      verification_completed, goal_completed           │
└────────────────────────────┬──────────────────────────┘
                             │ WebSocket
                             ▼
                     Client sees progress
```

## 2.5 IPC Communication

Gateway and Scheduler communicate over a Unix domain socket at `/tmp/ponybunny-ipc.sock` using line-delimited JSON.

**Direction: Scheduler → Gateway**:
- `scheduler_event` — Goal/WorkItem/Run state changes
- `session_event` — Conversation events (routed to specific gateway session)
- `debug_event` — Detailed instrumentation for debug dashboard

**Direction: Gateway → Scheduler**:
- `scheduler_command` — Commands with `requestId` for request/response correlation
  - `submit_goal`, `cancel_goal`, `materialize_goal`, `replay_run`
  - `session_open`, `session_message`, `session_history`, `session_end`
  - `apply_runtime_rollout`, `set_agent_model_override`

**Reliability**:
- Auto-reconnection with exponential backoff (1s → 30s max)
- Message buffering during disconnection (up to 1000 messages)
- Heartbeat ping/pong for liveness detection
- Graceful disconnect with reason

## 2.6 Execution Modes

The scheduler supports two execution dispatch modes:

### Direct Mode (Default)
Scheduler calls `executeWorkItem()` synchronously and awaits the full result.

### Evented Mode
Scheduler publishes a `task.ready` event; a `LocalExecutionWorker` picks it up asynchronously. Results are claimed via a transactional mechanism to prevent duplicate application. Supports:
- **Orphan detection** — Identifies in-flight runs from previous crashes
- **Manual replay** — Operator-initiated re-execution
- **Result continuation claims** — Deduplication with statuses: `claimed`, `already_applied`, `suppressed_by_replay`, `already_terminal`

## 2.7 Web Frontend

The `web/` directory contains a separate Next.js 16 application:

- **Stack**: React 19 + Tailwind 4 + shadcn/ui + Monaco Editor + Framer Motion
- **Pages**: Chat interface, configuration UI, system status
- **Separate** `package.json` and `node_modules` from the main project
- Communicates with Gateway via the same WebSocket protocol

## 2.8 ADR-001 Composition Topology

The harness layer introduces a clean separation of concerns:

```
┌────────────────────────────────────────────────┐
│          HarnessDaemon (Polling Loop)           │
│  - pollingIntervalMs: 5000ms                   │
│  - maxConcurrentGoals: 2                       │
│  - Concurrency gating via activeGoalCount      │
│  - Delegates PostGoalEvaluator lifecycle        │
└────────────────┬───────────────────────────────┘
                 │ processQueuedGoal()
┌────────────────▼───────────────────────────────┐
│      GoalHarness (Stateless, No Timers)        │
│  elaboratePlanDelegate():                      │
│    1. Elaborate (GlobalKnowledge injection)     │
│    2. Check escalations → block if any         │
│    3. Plan work items (DAG via LLM)            │
│    4. Mark goal active                         │
│    5. Delegate to SchedulerCore                │
└────────────────┬───────────────────────────────┘
                 │ submitGoal()
┌────────────────▼───────────────────────────────┐
│     SchedulerCore (Execution Infrastructure)   │
│  - 1000ms tick loop                            │
│  - Lane selector (main/subagent/cron/session)  │
│  - Model selector (complexity scoring)         │
│  - Budget tracker (tokens/time/cost)           │
│  - Quality gates, retry handler                │
│  - Emits: goal_completed, goal_failed          │
└────────────────┬───────────────────────────────┘
                 │ event subscription
┌────────────────▼───────────────────────────────┐
│     PostGoalEvaluator (Observational Only)     │
│  - Subscribes to goal_completed/goal_failed    │
│  - Evaluates all work items' final runs        │
│  - Produces GoalEvaluationReport               │
│  - Bounded storage (max 100 reports)           │
│  - Fire-and-forget (never crashes scheduler)   │
└────────────────────────────────────────────────┘
```

**Key invariants**:
- GoalHarness NEVER performs execution
- SchedulerCore NEVER performs elaboration or planning
- PostGoalEvaluator NEVER modifies scheduler state
- All three components interact via well-defined interfaces only
