# 01 - System Overview

## 1.1 Purpose

PonyBunny is an **Autonomous AI Employee System** — a local-first CLI + server runtime where humans set goals and AI delivers results autonomously. It bridges the delegation bottleneck in knowledge work by providing a structured, auditable pipeline from goal definition to verified artifact delivery.

## 1.2 Core Capabilities

| Capability | Description |
|------------|-------------|
| **Goal-Driven Autonomy** | Users submit goals with success criteria; the system decomposes, plans, executes, and verifies work autonomously |
| **Harness-First Composition** | GoalHarness (elaborate → plan) composes over SchedulerCore (execute + infra) via ADR-001 |
| **8-Phase Lifecycle** | Intake → Elaboration → Planning → Execution → Verification → Evaluation → Publish → Monitor |
| **Multi-LLM Support** | Anthropic Claude, OpenAI GPT, Google Gemini with tier-based routing and automatic fallback |
| **Tool Integration** | Built-in tools (filesystem, shell, git, code) + MCP protocol for external tools |
| **Budget Enforcement** | Token, time, and cost budgets with warning thresholds and automatic escalation |
| **Escalation System** | Structured human intervention for stuck, ambiguous, risky, or credential-requiring situations |
| **Post-Goal Evaluation** | Observational evaluation of completed/failed goals via PostGoalEvaluator (ADR-001 Phase 5) |
| **Audit Trail** | Complete logging of all mutations with actor, action, entity, and changeset tracking |
| **Conversation Interface** | Interactive chat with persona support, memory, and goal materialization from natural language |
| **Cron Scheduling** | Durable recurring agent schedules with claim-based distributed locking |
| **Cross-Goal Learning** | GlobalKnowledgeService extracts pitfalls/patterns across goals, injected during elaboration |

## 1.3 Technology Stack

| Layer | Technology |
|-------|-----------|
| **Language** | TypeScript (ES2022, strict mode, ESM) |
| **Runtime** | Node.js ≥18 |
| **CLI Framework** | Commander.js |
| **Terminal UI** | Ink (React for terminal) |
| **Web Frontend** | Next.js 16 + Tailwind 4 + shadcn/ui (separate package in `web/`) |
| **Database** | SQLite via better-sqlite3 (embedded, local-first) |
| **WebSocket** | ws library |
| **IPC** | Unix domain socket (line-delimited JSON) |
| **Authentication** | Ed25519 challenge-response (via @noble/ed25519) |
| **LLM Protocols** | Native Anthropic, OpenAI, Gemini REST APIs |
| **Tool Protocol** | Model Context Protocol (MCP) SDK |
| **Schema Validation** | AJV 2020 |
| **Build** | TypeScript compiler (tsc) |
| **Test** | Jest 30 with ts-jest ESM preset (1928 tests) |

## 1.4 Process Architecture

PonyBunny runs as **two cooperating processes** plus optional clients:

```
┌─────────────────┐       ┌──────────────────────┐
│  Gateway Server  │◄─────►│  Scheduler Daemon     │
│  (WebSocket)     │  IPC  │  (Execution Engine)   │
│  Port :18789     │ Unix  │                       │
│                  │Socket │  - GoalHarness         │
│  - Auth          │       │  - SchedulerCore       │
│  - RPC Dispatch  │       │  - PostGoalEvaluator   │
│  - Event Bcast   │       │  - ReAct Loop          │
│  - Audit Log     │       │  - LLM Calls           │
└────────▲─────────┘       │  - Tool Execution      │
         │ WebSocket       │  - Budget Tracking     │
┌────────┴─────────┐       │  - Quality Gates       │
│    Clients        │       └──────────────────────┘
│  - pb (TUI)      │
│  - Web UI        │
│  - API consumers │
└──────────────────┘
```

The **Gateway** handles all external communication (WebSocket, auth, message routing). The **Scheduler Daemon** handles all execution logic (LLM calls, tools, state management). They communicate over a Unix domain socket using a structured IPC protocol.

**ADR-001 Composition**: Both the main entry point (`main.ts` via HarnessDaemon) and the scheduler daemon route goals through GoalHarness for elaboration and planning before delegating to SchedulerCore for execution.

## 1.5 Configuration

All configuration lives in `~/.config/ponybunny/` (legacy `~/.ponybunny/` auto-migrates):

| File | Purpose |
|------|---------|
| `ponybunny.json` | Runtime configuration (scheduler, gateway, features) |
| `credentials.json` | API keys for LLM providers (sensitive) |
| `llm-config.json` | Provider definitions, model catalog, tier mappings |
| `mcp-config.json` | MCP server configurations |
| `auth.json` | OAuth tokens |
| `gateway.pid` / `scheduler.pid` | Process info for service management |
| `gateway.log` / `scheduler.log` | Service logs |

## 1.6 CLI Binary

The system is accessed via the `pb` command:

```bash
pb                         # Interactive TUI
pb service start all       # Start Gateway + Scheduler
pb work "implement feature X"  # Direct autonomous execution
pb debug web               # Web-based debug dashboard
```

## 1.7 Key Design Principles

1. **Harness-first**: GoalHarness composes over SchedulerCore — elaboration and planning separated from execution
2. **Local-first**: All data stays on the user's machine (SQLite, local config)
3. **Hexagonal architecture**: Strict layer separation with dependency injection
4. **Structured escalation**: AI never silently fails — it escalates with context
5. **Budget-aware**: Every execution tracks token/time/cost against limits
6. **Auditable**: Every state change is logged with actor and reasoning
7. **Provider-agnostic**: LLM providers are interchangeable via protocol adapters
8. **Deterministic recovery**: Evented execution mode enables run replay and orphan recovery
9. **Observational evaluation**: PostGoalEvaluator produces reports without side effects on scheduler state
