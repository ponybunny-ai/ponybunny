# 01 - System Overview

## 1.1 Purpose

PonyBunny is an **Autonomous AI Employee System** — a local-first CLI + server runtime where humans set goals and AI delivers results autonomously. It bridges the delegation bottleneck in knowledge work by providing a structured, auditable pipeline from goal definition to verified artifact delivery.

## 1.2 Core Capabilities

| Capability | Description |
|------------|-------------|
| **Goal-Driven Autonomy** | Users submit goals with success criteria; the system decomposes, plans, executes, and verifies work autonomously |
| **8-Phase Lifecycle** | Intake → Elaboration → Planning → Execution → Verification → Evaluation → Publish → Monitor |
| **Multi-LLM Support** | Anthropic Claude, OpenAI GPT, Google Gemini with tier-based routing and automatic fallback |
| **Tool Integration** | Built-in tools (filesystem, shell, git, code) + MCP protocol for external tools |
| **Budget Enforcement** | Token, time, and cost budgets with warning thresholds and automatic escalation |
| **Escalation System** | Structured human intervention for stuck, ambiguous, risky, or credential-requiring situations |
| **Audit Trail** | Complete logging of all mutations with actor, action, entity, and changeset tracking |
| **Conversation Interface** | Interactive chat with persona support, memory, and goal materialization from natural language |
| **Cron Scheduling** | Durable recurring agent schedules with claim-based distributed locking |

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
| **Test** | Jest 30 with ts-jest ESM preset |

## 1.4 Process Architecture

PonyBunny runs as **two cooperating processes** plus optional clients:

```
┌─────────────────┐       ┌─────────────────────┐
│  Gateway Server  │◄─────►│  Scheduler Daemon    │
│  (WebSocket)     │  IPC  │  (Execution Engine)  │
│  Port :18789     │ Unix  │                      │
│                  │Socket │  - ReAct Loop         │
│  - Auth          │       │  - LLM Calls          │
│  - RPC Dispatch  │       │  - Tool Execution     │
│  - Event Bcast   │       │  - Budget Tracking    │
│  - Audit Log     │       │  - Quality Gates      │
└────────▲─────────┘       └──────────────────────┘
         │ WebSocket
┌────────┴─────────┐
│    Clients        │
│  - pb (TUI)      │
│  - Web UI        │
│  - API consumers │
└──────────────────┘
```

The **Gateway** handles all external communication (WebSocket, auth, message routing). The **Scheduler Daemon** handles all execution logic (LLM calls, tools, state management). They communicate over a Unix domain socket using a structured IPC protocol.

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

1. **Local-first**: All data stays on the user's machine (SQLite, local config)
2. **Hexagonal architecture**: Strict layer separation with dependency injection
3. **Structured escalation**: AI never silently fails — it escalates with context
4. **Budget-aware**: Every execution tracks token/time/cost against limits
5. **Auditable**: Every state change is logged with actor and reasoning
6. **Provider-agnostic**: LLM providers are interchangeable via protocol adapters
7. **Deterministic recovery**: Evented execution mode enables run replay and orphan recovery
