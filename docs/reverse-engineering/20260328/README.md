# PonyBunny System Reverse Engineering

**Date:** 2026-03-28
**System Version:** 1.0.0
**Codebase:** TypeScript/Node.js (ESM), ~100+ source files

## Purpose

This document set captures a comprehensive reverse engineering snapshot of the PonyBunny Autonomous AI Employee System as of 2026-03-28. It is intended for onboarding, architectural review, and long-term maintenance planning.

## Document Index

| # | Document | Scope |
|---|----------|-------|
| 01 | [System Overview](./01-system-overview.md) | Purpose, scope, high-level capabilities, technology stack |
| 02 | [Architecture](./02-architecture.md) | Hexagonal architecture, layer rules, component topology, data flow |
| 03 | [Domain Model](./03-domain-model.md) | Core entities, state machines, invariants, business rules |
| 04 | [Data Model](./04-data-model.md) | SQLite schema, tables, indexes, repository interfaces |
| 05 | [API Reference](./05-api-reference.md) | WebSocket protocol, RPC methods, IPC protocol, event types |
| 06 | [Scheduler & Runtime](./06-scheduler-runtime.md) | 8-phase lifecycle, execution engine, lanes, budget, retry, quality gates |
| 07 | [Infrastructure](./07-infrastructure.md) | LLM providers, tool system, MCP integration, configuration |
| 08 | [CLI & TUI Reference](./08-cli-tui.md) | All CLI commands, TUI architecture, service management |
| 09 | [Security & Auth](./09-security-auth.md) | Authentication flow, permission model, tool responsibility layers |

## System at a Glance

```
                        ┌──────────────────────────────────────────────────┐
                        │                   Clients                        │
                        │   CLI/TUI (Ink)  │  Web UI (Next.js)  │  API    │
                        └────────┬─────────┴──────────┬─────────┴────┬────┘
                                 │ WebSocket :18789    │              │
                        ┌────────▼────────────────────────────────────▼────┐
                        │              Gateway Server                      │
                        │  Auth │ RPC Handlers │ Event Broadcast │ Channels│
                        └────────┬────────────────────────────────────────┘
                                 │ IPC (Unix Socket)
                        ┌────────▼────────────────────────────────────────┐
                        │           Scheduler Daemon                       │
                        │  Lane Selector │ Model Selector │ Budget Tracker │
                        │  Quality Gates │ Retry Handler  │ Escalations    │
                        └────────┬────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
     ┌────────────┐    ┌────────────┐     ┌────────────┐
     │  LLM APIs  │    │   Tools    │     │  SQLite DB │
     │ Claude/GPT │    │ Built-in + │     │ Goals/Runs │
     │  /Gemini   │    │    MCP     │     │ /Artifacts │
     └────────────┘    └────────────┘     └────────────┘
```

## Reading Order

- **New to the project**: Start with 01 → 02 → 03 → 06
- **Backend/infrastructure focus**: 04 → 05 → 07
- **Operations/deployment focus**: 08 → 09
- **Full review**: Read sequentially 01 through 09
