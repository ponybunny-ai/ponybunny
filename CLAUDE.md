# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PonyBunny is an **Autonomous AI Employee System** that solves the **delegation bottleneck** in knowledge work. Like OpenClaw, it is fundamentally a **Gateway + Scheduler** architecture. Humans set goals, AI delivers complete results autonomously.

### Core Success Metrics

| Metric | Target | Why It Matters |
|:-------|:-------|:---------------|
| Work Item Autonomy Rate | >70% | Core autonomy indicator |
| Continuous Work Shift | ≥8 hours | Validates "hands-off" capability |
| Quality Gate Pass Rate | >80% | Self-quality assurance |
| Monthly API Cost | <$10 | Affordable for individuals |

## System Architecture: Gateway + Scheduler

PonyBunny consists of two core components:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         External World                               │
│  CLI Client  │  TUI Client  │  Web Client  │  Other Agents          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ WS / WSS (长连接)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Gateway                                     │
│  - WS/WSS connection management (heartbeat, reconnect)              │
│  - Inbound: Goals, approvals, info supplements, cancellations       │
│  - Outbound: Status updates, escalations, results, live logs        │
│  - Authentication & authorization                                    │
│  - Message routing to Scheduler                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ Internal events/commands
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Scheduler (Core Brain)                            │
│  Acts as the Agent, responsible for:                                │
│                                                                      │
│  1. Task Clarification  - Parse Goal, resolve ambiguity             │
│  2. Task Decomposition  - Break into Work Items (DAG)               │
│  3. Success Definition  - Generate Verification Plan                │
│  4. Model Selection     - Choose LLM based on task complexity       │
│  5. Lane Selection      - Assign to Main/Subagent/Cron/Session      │
│  6. Execution Monitor   - Track progress, detect anomalies          │
│  7. Result Evaluation   - Judge done/retry/escalate                 │
│  8. Retry Adjustment    - Switch strategy/model on failure          │
│                                                                      │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                        Skills                                  │  │
│  │  High-level capabilities combining multiple tools              │  │
│  │  Examples: implement_feature, write_tests, create_pr, deploy   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                        Tools                                   │  │
│  │  Atomic operations with allowlist control                      │  │
│  │  Examples: read_file, write_file, shell, git, http_request     │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     OS Services                                │  │
│  │  System-level apps and services requiring permissions          │  │
│  │  Examples: Keychain, Browser, Docker, Network services         │  │
│  │                                                                │  │
│  │  Permission flow: Check → Request (sudo/OAuth/confirm) →      │  │
│  │                   Retry on failure → Escalate if exhausted     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Persistence                                   │
│  SQLite: Goals, Work Items, Runs, Artifacts, Decisions              │
└─────────────────────────────────────────────────────────────────────┘
```

## Gateway Detailed Design

### Core Responsibilities

| Responsibility | Description |
|:---------------|:------------|
| **Connection Mgmt** | Maintain WS/WSS connections, heartbeat, reconnection |
| **Inbound Messages** | Receive Goal submissions, approvals, info, cancellations |
| **Outbound Messages** | Push status, escalations, results, real-time logs |
| **Auth** | Verify client identity, manage sessions |
| **Routing** | Dispatch messages to correct Scheduler instance/Lane |

### WebSocket Protocol (JSON-RPC Style)

```
Port: 18789 (default)
Protocol: WS (dev) / WSS (prod)

Frame Types:
┌─────────────────────────────────────────────────────────────┐
│ Request (req)                                               │
│ { "type": "req", "id": "uuid", "method": "...", "params": } │
├─────────────────────────────────────────────────────────────┤
│ Response (res)                                              │
│ { "type": "res", "id": "uuid", "result": ... }              │
│ { "type": "res", "id": "uuid", "error": { code, message } } │
├─────────────────────────────────────────────────────────────┤
│ Event (event) - Server push, no response expected           │
│ { "type": "event", "event": "...", "data": ... }            │
└─────────────────────────────────────────────────────────────┘
```

### Connection Lifecycle

```
Client                              Gateway
   │                                   │
   │──── WS Connect ──────────────────►│
   │                                   │
   │◄─── event: connect.challenge ─────│  { challenge: "random-bytes" }
   │                                   │
   │──── req: connect ────────────────►│  { signature, publicKey, pairingToken }
   │                                   │
   │◄─── res: connect ─────────────────│  { sessionId, serverVersion }
   │                                   │
   │         ═══ Authenticated ═══     │
   │                                   │
   │──── req: goal.submit ────────────►│
   │◄─── event: goal.accepted ─────────│
   │◄─── event: workitem.started ──────│
   │◄─── event: workitem.progress ─────│  (streaming)
   │◄─── event: escalation ────────────│  (if needed)
   │──── req: escalation.respond ─────►│
   │◄─── event: workitem.completed ────│
   │◄─── event: goal.completed ────────│
   │                                   │
   │──── ping ────────────────────────►│  (every 30s)
   │◄─── pong ─────────────────────────│
```

### RPC Methods (Gateway → Scheduler)

| Method | Direction | Description |
|:-------|:----------|:------------|
| `goal.submit` | Client→GW→Scheduler | Submit new Goal |
| `goal.cancel` | Client→GW→Scheduler | Cancel running Goal |
| `goal.status` | Client→GW→Scheduler | Query Goal status |
| `workitem.list` | Client→GW→Scheduler | List Work Items for Goal |
| `escalation.respond` | Client→GW→Scheduler | Human response to escalation |
| `approval.grant` | Client→GW→Scheduler | Approve pending operation |
| `approval.deny` | Client→GW→Scheduler | Deny pending operation |
| `config.get` | Client→GW | Get configuration |
| `config.set` | Client→GW | Update configuration |

### Events (Scheduler → Gateway → Client)

| Event | Description | Data |
|:------|:------------|:-----|
| `goal.accepted` | Goal received and queued | `{ goalId, estimatedItems }` |
| `goal.started` | Goal execution began | `{ goalId }` |
| `goal.completed` | Goal finished | `{ goalId, status, artifacts }` |
| `workitem.started` | Work Item execution began | `{ workItemId, title }` |
| `workitem.progress` | Streaming progress | `{ workItemId, delta, tokens }` |
| `workitem.completed` | Work Item finished | `{ workItemId, status, artifacts }` |
| `escalation` | Human intervention needed | `{ escalationId, packet }` |
| `approval.required` | Operation needs approval | `{ approvalId, action, impact }` |
| `error` | System error | `{ code, message, recoverable }` |

### Authentication Flow (Triple-Check)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Authentication (WHO are you?)                                │
│    - Ed25519 signature verification                             │
│    - Client signs challenge with private key                    │
│    - Gateway verifies with stored public key                    │
├─────────────────────────────────────────────────────────────────┤
│ 2. Authorization (WHAT can you do?)                             │
│    - Pairing token validation                                   │
│    - Token grants specific permissions (read/write/admin)       │
│    - Token can be revoked server-side                           │
├─────────────────────────────────────────────────────────────────┤
│ 3. Command Allowlist (HOW can you do it?)                       │
│    - Per-session command whitelist                              │
│    - Dangerous commands require explicit approval               │
│    - Audit log for all commands                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Gateway Internal Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Gateway                                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ WS Server    │  │ Connection   │  │ Auth         │          │
│  │ (uWebSockets)│  │ Manager      │  │ Manager      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│         └────────────┬────┴─────────────────┘                   │
│                      │                                          │
│              ┌───────▼───────┐                                  │
│              │ Message Router │                                  │
│              └───────┬───────┘                                  │
│                      │                                          │
│         ┌────────────┼────────────┐                             │
│         │            │            │                             │
│  ┌──────▼──────┐ ┌───▼───┐ ┌─────▼─────┐                       │
│  │ RPC Handler │ │ Event │ │ Broadcast │                       │
│  │ (req/res)   │ │ Queue │ │ Manager   │                       │
│  └──────┬──────┘ └───┬───┘ └─────┬─────┘                       │
│         │            │           │                              │
│         └────────────┼───────────┘                              │
│                      │                                          │
│              ┌───────▼───────┐                                  │
│              │ Scheduler Bus │  (Internal event bus)            │
│              └───────────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Error Codes

| Code | Name | Description |
|:-----|:-----|:------------|
| -32700 | PARSE_ERROR | Invalid JSON |
| -32600 | INVALID_REQUEST | Invalid request structure |
| -32601 | METHOD_NOT_FOUND | Unknown RPC method |
| -32602 | INVALID_PARAMS | Invalid method parameters |
| -32603 | INTERNAL_ERROR | Internal server error |
| -32000 | AUTH_REQUIRED | Authentication required |
| -32001 | AUTH_FAILED | Authentication failed |
| -32002 | PERMISSION_DENIED | Insufficient permissions |
| -32003 | RATE_LIMITED | Too many requests |
| -32004 | GOAL_NOT_FOUND | Goal ID not found |
| -32005 | ALREADY_RUNNING | Goal already in progress |

### Scheduler Responsibilities (as Agent)

| Phase | Scheduler Behavior |
|:------|:-------------------|
| **Clarify** | Analyze Goal, identify ambiguity, request clarification via Gateway |
| **Decompose** | Break Goal into Work Items DAG, identify dependencies |
| **Define Success** | Generate Verification Plan (tests, build, lint) per Work Item |
| **Select Model** | Simple tasks → cheap model; Complex → powerful model |
| **Select Lane** | Assign to appropriate concurrency Lane |
| **Monitor** | Track tokens, time, errors; detect stuck states |
| **Evaluate** | Run Quality Gates, determine if requirements met |
| **Retry** | On failure: switch strategy → switch model → escalate |

### Invocation Chain: Scheduler → Skills → Tools → OS Services

```
Scheduler (Agent)
    │
    ├──► Skill: "implement_login"
    │        ├──► Tool: read_file("src/auth/...")
    │        ├──► Tool: write_file("src/auth/login.ts", code)
    │        ├──► Tool: shell("npm test")
    │        └──► Tool: git("commit", "feat: add login")
    │
    ├──► Skill: "deploy_production"
    │        ├──► Tool: shell("docker build")
    │        ├──► OS Service: Get AWS credentials (requires permission)
    │        │        └──► Permission retry mechanism
    │        └──► Tool: shell("kubectl apply")
    │
    └──► Direct OS Service call
             └──► Open browser, send notification, access Keychain...
```

### Permission Acquisition Flow

```
Scheduler needs privileged operation
         │
         ▼
    Check permission cache
         │
    ┌────┴────┐
    │         │
  Has perm  No perm
    │         │
    ▼         ▼
  Execute   Request auth
              │
    ┌─────────┼─────────┐
    │         │         │
  sudo     OAuth    User confirm
    │         │         │
    └─────────┼─────────┘
              │
    ┌─────────┴─────────┐
    │                   │
  Success            Failure
    │                   │
    ▼                   ▼
  Cache perm        Retry (N times)
  Execute               │
                        ▼
                  Escalate to human
```

## AI Employee Paradigm

PonyBunny implements an **AI Employee** (not assistant) model:

### Three-Layer Responsibility Model

**Layer 1 - Fully Autonomous (AI decides and executes):**
- Read/analyze code, run tests/builds
- Write code (in sandbox), generate docs
- Retry on errors (<3 times)
- Select tools and strategies
- Run Quality Gates

**Layer 2 - Request Approval (AI proposes, human approves):**
- Database schema migrations
- Production deployments
- Resource deletion
- New dependency introduction
- Security config changes

**Layer 3 - Forbidden (AI must never attempt):**
- Modify host filesystem outside sandbox
- Execute dangerous commands (`rm -rf /`)
- Leak API keys or credentials
- Bypass security policies

### Escalation Philosophy

**Escalation is intelligent decision-making, not failure.** Triggers:
- 3 consecutive identical errors
- Budget exhausted (tokens/time/cost)
- Ambiguous goal definition
- Missing credentials
- Risk boundary reached

Escalation Packets must include: context, attempt history, current state, root cause analysis, and suggested options.

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

See `AGENTS.md` for detailed development patterns and testing guidelines.
See `docs/requirement/` for full requirements documentation.
See `docs/engineering/` for technical implementation details.
