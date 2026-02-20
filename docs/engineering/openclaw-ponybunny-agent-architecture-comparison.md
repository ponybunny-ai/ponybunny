# OpenClaw vs PonyBunny Agent Architecture Comparison (Final)

## Purpose

This document finalizes a contract-first comparison between OpenClaw and PonyBunny agent execution, with a concrete walkthrough for the user request:

"I want the top 10 hottest Reddit topics right now, plus a deep monetization feasibility analysis."

The goal is to identify what PonyBunny can borrow safely, what requires adaptation, and what should not be copied directly.

## Evidence Scope

All conclusions in this document are grounded in code-level evidence:

- OpenClaw routing and ingress: `openclaw/src/web/auto-reply/monitor/on-message.ts:67`, `openclaw/src/routing/resolve-route.ts:295`
- OpenClaw runtime assembly and execution: `openclaw/src/auto-reply/reply/commands-system-prompt.ts:27`, `openclaw/src/auto-reply/reply/get-reply.ts:53`, `openclaw/src/auto-reply/reply/get-reply-run.ts:109`, `openclaw/src/auto-reply/reply/agent-runner.ts:92`, `openclaw/src/auto-reply/reply/agent-runner-execution.ts:56`
- OpenClaw tool policy and tool construction: `openclaw/src/agents/pi-tools.policy.ts:188`, `openclaw/src/agents/pi-tools.ts:164`, `openclaw/src/agents/openclaw-tools.ts:82`
- OpenClaw web tools used by the Reddit scenario: `openclaw/src/agents/tools/web-search.ts:708`, `openclaw/src/agents/tools/web-fetch.ts:712`
- PonyBunny scheduler and execution chain: `pony/src/scheduler-daemon/daemon.ts:80`, `pony/src/scheduler-daemon/agent-scheduler.ts:57`, `pony/src/gateway/integration/execution-engine-adapter.ts:46`
- PonyBunny idempotency and cron state transitions: `pony/src/infra/persistence/schema.sql:474`, `pony/src/infra/persistence/work-order-repository.ts:837`, `pony/src/infra/persistence/work-order-repository.ts:898`, `pony/src/infra/persistence/work-order-repository.ts:920`, `pony/src/infra/persistence/work-order-repository.ts:943`
- PonyBunny current tool governance baseline: `pony/src/infra/tools/tool-registry.ts:1`
- Oracle review constraints: `ses_3840dcf4affeYdbAHTpFR6RkyT` (contract-surface and false-equivalence warnings)

## 1) OpenClaw Execution for the Reddit Request

### Sequence (actual chain)

1. Message ingress receives the WhatsApp/web inbound message and resolves route immediately via `resolveAgentRoute(...)` using channel/account/peer bindings, not semantic task classification (`on-message.ts:67`, `resolve-route.ts:295`).
2. Route result includes `agentId`, `sessionKey`, `mainSessionKey`, and `matchedBy`, establishing identity and storage keys before model execution (`resolve-route.ts:38`, `resolve-route.ts:309`).
3. Inbound context is normalized and persisted with route metadata, then dispatched through buffered reply execution (`process-message.ts:287`, `process-message.ts:354`).
4. Reply pipeline enters `getReplyFromConfig(...)`, initializes session state, directives, and command auth state (`get-reply.ts:53`, `get-reply.ts:137`, `get-reply.ts:143`, `get-reply.ts:296`).
5. `runPreparedReply(...)` builds runtime context for agent run (queue mode, session lane, followup run envelope, model/elevation settings) and calls `runReplyAgent(...)` (`get-reply-run.ts:109`, `get-reply-run.ts:438`).
6. Prompt and tools are assembled dynamically in `resolveCommandsSystemPromptBundle(...)`, including skill snapshot, sandbox status, tool summaries, runtime info (`commands-system-prompt.ts:27`, `commands-system-prompt.ts:53`, `commands-system-prompt.ts:110`).
7. Tool set is constructed with policy pipeline and ownership filters in `createOpenClawCodingTools(...)` (`pi-tools.ts:164`, `pi-tools.ts:231`, `pi-tools.ts:465`).
8. For this Reddit request, `web_search` and `web_fetch` are available (if enabled) and can be used to gather fresh sources, then synthesize top-10 + monetization analysis (`openclaw-tools.ts:82`, `openclaw-tools.ts:86`, `web-search.ts:708`, `web-fetch.ts:712`).
9. Runtime executes through embedded/CLI runner and streams outputs/events via `runAgentTurnWithFallback(...)` (`agent-runner.ts:92`, `agent-runner-execution.ts:56`).

### Key property

OpenClaw is ingress-and-route first: who handles the request and which session/tool envelope is used are decided early, then the model executes inside that envelope.

## 2) PonyBunny Equivalent Chain for the Same Intent

### Sequence (current architecture)

1. Scheduler daemon starts, loads agent registry, reconciles cron jobs, and starts dispatch loop (`daemon.ts:80`, `daemon.ts:97`, `daemon.ts:153`).
2. `dispatchOnce(...)` claims due cron jobs with TTL-based claim semantics (`agent-scheduler.ts:57`, `agent-scheduler.ts:58`).
3. Scheduler computes due outcome and creates/gets idempotent run records (`agent-scheduler.ts:94`, `agent-scheduler.ts:124`).
4. Goal + work item are created; cron run is linked and marked in flight (`agent-scheduler.ts:152`, `agent-scheduler.ts:174`, `agent-scheduler.ts:201`, `agent-scheduler.ts:202`).
5. `submitGoal(...)` hands off to scheduler core (`agent-scheduler.ts:228`).
6. `ExecutionEngineAdapter.execute(...)` branches by work item context:
   - `agent_tick` path calls `runner.runTick(...)` (`execution-engine-adapter.ts:47`, `execution-engine-adapter.ts:108`)
   - otherwise delegates to generic lifecycle execution service (`execution-engine-adapter.ts:156`).
7. Persistent guarantees come from repository and schema contracts:
   - single run per `(agent_id, scheduled_for_ms)` (`schema.sql:474`)
   - claim/in-flight/outcome transitions (`work-order-repository.ts:837`, `work-order-repository.ts:898`, `work-order-repository.ts:920`, `work-order-repository.ts:943`).

### Key property

PonyBunny is schedule-and-dispatch first: durable due-work and idempotent run tracking are primary contracts; message ingress routing is not currently the primary control point in this chain.

## 3) Contract Surface Comparison

| Contract Surface | OpenClaw | PonyBunny | Migration Implication |
| --- | --- | --- | --- |
| Routing authority | Binding-based route resolution at ingress (`resolve-route.ts:295`) | Due-claim and scheduler dispatch authority (`agent-scheduler.ts:57`) | Do not equate route binding with cron dispatch ownership |
| Session identity | `sessionKey/mainSessionKey` created pre-run (`resolve-route.ts:311`) | `run_key` and goal/work item linkage (`agent-scheduler.ts:201`) | Need explicit mapping layer if adding ingress contracts |
| Prompt/tool assembly | Runtime bundle per turn (`commands-system-prompt.ts:27`) | Tool allowlist/enforcer attached to work item/tool context (`tool-registry.ts:1`) | Borrow layering intent, keep Pony run contracts intact |
| Tool policy enforcement | Multi-layer pipeline + owner-only + sandbox/subagent (`pi-tools.ts:465`, `pi-tools.policy.ts:188`) | Current baseline is flat allowlist + approval flags (`tool-registry.ts:51`) | Safe to add layered policy model in Pony |
| Execution guarantees | Run loop fallback/streaming emphasis (`agent-runner-execution.ts:56`) | Idempotent cron run uniqueness + explicit state transitions (`schema.sql:474`) | Preserve Pony durability semantics as source of truth |

## 4) Borrowability Matrix

### A. Safe to borrow directly (low risk)

1. Policy layering model for tools (global/provider/agent/group/subagent/sandbox precedence) from OpenClaw policy pipeline shape.
2. Runtime tool-summary generation pattern to improve prompt/tool transparency.
3. Owner-only class of tools for sensitive operations.

Why low risk: these are governance overlays and can be inserted without changing Pony's scheduler idempotency core.

### B. Borrow with adaptation (medium risk)

1. Ingress route contract abstraction (OpenClaw-style route envelope), but adapted to produce a stable context artifact consumed by Pony work-item creation.
2. Dynamic per-run prompt/tool bundle behavior in agent execution, while preserving existing execution adapter boundaries.

Why medium risk: cross-cutting with scheduler, execution adapter, and persistence metadata.

### C. Do not copy directly (high risk)

1. OpenClaw's full monitor/reply orchestration loop as a replacement for Pony scheduler loop.
2. Any design that weakens `(agent_id, scheduled_for_ms)` idempotency and explicit in-flight state transitions.

Why high risk: this would collapse Pony's core execution guarantees and ownership boundaries.

## 5) Recommended Rollout Order (Minimal-Risk Path)

### Phase 1 - Tool policy layering in Pony (first)

Implement layered policy resolution around current `ToolRegistry`/`ToolAllowlist`/`ToolEnforcer` (`tool-registry.ts:1`).

Deliverables:

- Policy spec and precedence order
- Deterministic resolver implementation
- Migration compatibility with existing allowlist behavior

### Phase 2 - Route contract artifact (second)

Introduce a normalized `routeContext` record that can be attached to work item context, without replacing scheduler due-claim/idempotent flow.

Deliverables:

- Route contract schema
- Ingestion adapter to populate `routeContext`
- Explicit mapping to execution adapter inputs

### Phase 3 - Prompt/tool runtime enrichment (third)

Add dynamic bundle construction (prompt sections + tool summaries + route context hints) in runner execution path.

Deliverables:

- Runtime bundle composer
- Provider-aware tool profile support
- Trace/audit fields linking decision -> tool set -> execution

## 6) Acceptance Criteria and Test Plan

### Policy layering tests

1. Conflict precedence is deterministic and documented.
2. Deny at any applicable layer blocks execution even if lower layers allow.
3. Owner-only tools are inaccessible for non-owner contexts.

### Execution safety tests

1. Idempotency invariant holds with layered policy enabled: one effective run for same `(agent_id, scheduled_for_ms)`.
2. In-flight and claim fields clear correctly on success/failure transitions.
3. Tool denial remains enforceable at execution boundary (not prompt-only).

### Route-context integration tests

1. `routeContext` variations change selected tool envelope as designed.
2. Cron consistency fields remain unaffected by ingress metadata changes.
3. Audit logs can explain why a given tool set was selected.

## 7) Risks and Guardrails (Oracle-Aligned)

The major risk is false equivalence: copying OpenClaw feature names while changing Pony contract semantics. Guardrails:

1. Treat routing, tool governance, and execution guarantees as independent contract surfaces.
2. Mark every non-proven behavior as unknown until backed by code/tests.
3. Do not ship prompt-only controls as security controls.
4. Keep Pony scheduler durability guarantees as non-negotiable baseline.

## Final Recommendation

Proceed with contract-first borrowing:

1. Start with tool policy layering.
2. Add route-context contract artifact next.
3. Then enrich prompt/tool runtime composition.

This order captures most OpenClaw governance value while preserving PonyBunny's durable scheduler guarantees.
