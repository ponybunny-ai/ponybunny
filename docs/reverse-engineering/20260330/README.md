# PonyBunny System Reverse Engineering

**Date:** 2026-03-30
**System Version:** 1.0.0
**Codebase:** TypeScript/Node.js (ESM), ~120+ source files
**ADR-001 Status:** Fully verified (all 5 phases)
**ADR-002 Status:** Fully verified (all 18 phase items A1-F1, 2185 tests)

## Purpose

This document set captures a comprehensive reverse engineering snapshot of the PonyBunny Autonomous AI Employee System as of 2026-03-30. It is intended for onboarding, architectural review, and long-term maintenance planning.

## Changes Since 2026-03-29

| Change | Scope | Status |
|--------|-------|--------|
| ADR-002 A1 — Structured LLM errors (`LLMErrorCode`, `LLMProviderError`) | `src/infra/llm/llm-error.ts` | verified |
| ADR-002 A2 — Circuit breaker for LLM provider endpoints | `src/infra/llm/circuit-breaker.ts` | verified |
| ADR-002 B2 — `UnifiedLLMService` (single LLM entry point) | `src/infra/llm/unified-llm-service.ts` | verified |
| ADR-002 C1 — `ILogger` (JsonLogger) injected into all service files | 44+ files, zero `console.*` in non-CLI code | verified |
| ADR-002 C2 — `IMetricsRecorder` wired into PostGoalEvaluator, main.ts, daemon | `src/infra/observability/sqlite-metrics-recorder.ts` | verified |
| ADR-002 C3 — `ITracer` (RuntimeEventTracer) wired into entry points | `src/infra/observability/runtime-event-tracer.ts` | verified |
| ADR-002 D1 — Memory management: embedding LRU cache, report bounding | `src/infra/persistence/embedding-lru-cache.ts` | verified |
| ADR-002 D3 — Persistent metrics increment + scheduler metrics flush | HarnessDaemon 60s flush interval | verified |
| ADR-002 E2 — Tool execution timeout enforcement | `src/runtime/react/react-integration.ts` | verified |
| ADR-002 E3 — IPC backpressure buffer | `src/ipc/backpressure-buffer.ts` | verified |
| ADR-002 E4 — Auth config support for connection policies | `src/gateway/gateway-server.ts` | verified |
| ADR-002 F1 — Audit action naming convention | `src/domain/audit/audit-naming.ts` | verified |
| Migration v2 — metric_counters + metric_samples tables | `src/infra/persistence/migrations/` | verified |
| Migration v3 — goal_evaluation_reports table | `src/infra/persistence/migrations/` | verified |
| Test count increased | 1928 → 2185 (+257 tests) | verified |

## Document Index

| # | Document | Scope |
|---|----------|-------|
| 01 | [System Overview](./01-system-overview.md) | Purpose, scope, high-level capabilities, technology stack |
| 02 | [Architecture](./02-architecture.md) | Hexagonal architecture, layer rules, component topology, data flow |
| 03 | [Domain Model](./03-domain-model.md) | Core entities, state machines, invariants, business rules |
| 04 | [Data Model](./04-data-model.md) | SQLite schema, tables, indexes, repository interfaces |
| 05 | [API Reference](./05-api-reference.md) | WebSocket protocol, RPC methods, IPC protocol, event types |
| 06 | [Scheduler & Runtime](./06-scheduler-runtime.md) | 8-phase lifecycle, execution engine, lanes, budget, retry, quality gates |
| 07 | [Infrastructure](./07-infrastructure.md) | LLM providers, tool system, MCP integration, configuration, observability |
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
                        │  ILogger │ IMetricsRecorder │ ITracer (ADR-002) │
                        └────────┬────────────────────────────────────────┘
                                 │ IPC (Unix Socket + BackpressureBuffer)
                        ┌────────▼────────────────────────────────────────┐
                        │           Scheduler Daemon                       │
                        │  GoalHarness │ SchedulerCore │ PostGoalEvaluator│
                        │  Lane Selector │ Model Selector │ Budget Tracker │
                        │  Quality Gates │ Retry Handler  │ Escalations    │
                        │  ILogger │ IMetricsRecorder │ ITracer (ADR-002) │
                        └────────┬────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
     ┌────────────┐    ┌────────────┐     ┌────────────┐
     │  LLM APIs  │    │   Tools    │     │  SQLite DB │
     │ Claude/GPT │    │ Built-in + │     │ Goals/Runs │
     │  /Gemini   │    │    MCP     │     │ /Artifacts │
     │ Circuit    │    └────────────┘     │ /Metrics   │
     │ Breaker    │                       │ /Traces    │
     └────────────┘                       └────────────┘
```

## ADR-001 Composition Architecture

```
┌─ HarnessDaemon (polling loop, concurrency gating) ──────────────────────┐
│                                                                          │
│  ┌─ GoalHarness (stateless, pre-execution lifecycle) ────────────────┐  │
│  │  elaborate (GlobalKnowledge injection) → plan (WorkItem DAG)      │  │
│  │  → delegate to SchedulerCore                                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ SchedulerCore (production execution infrastructure) ─────────────┐  │
│  │  tick loop → lane selection → model selection → execute → verify   │  │
│  │  → evaluate → budget tracking → retry/escalation                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ PostGoalEvaluator (observational, no side effects) ──────────────┐  │
│  │  subscribes to goal_completed/goal_failed events                   │  │
│  │  evaluates all work items' final runs → GoalEvaluationReport      │  │
│  │  records metrics via IMetricsRecorder (ADR-002)                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

## ADR-002 Observability Architecture

```
┌─ Observability Interfaces (constructor-injected, no singletons) ────────┐
│                                                                          │
│  ILogger (JsonLogger)         → Structured JSON Lines to stdout          │
│  IMetricsRecorder (SQLite)    → metric_counters + metric_samples tables  │
│  ITracer (RuntimeEventTracer) → runtime_events table (span lifecycle)    │
│                                                                          │
│  Pattern: Component receives logger.child({ component: 'Name' })        │
│  Default: NoopLogger / NoopMetricsRecorder / NoopTracer                 │
│  Lifecycle: Created at entry point → passed through DI → scoped per svc │
└──────────────────────────────────────────────────────────────────────────┘
```

## Reading Order

- **New to the project**: Start with 01 → 02 → 03 → 06
- **Backend/infrastructure focus**: 04 → 05 → 07
- **Operations/deployment focus**: 08 → 09
- **Full review**: Read sequentially 01 through 09
