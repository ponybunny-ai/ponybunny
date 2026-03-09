# Session 54: Runtime-Core Boundary Cleanup Design

## Scope and session constraints

This session is design-only. It does not implement runtime-core cleanup.

The design below preserves the current system lines established in Sessions 10-53:

- scheduler-owned run identity and execution/recovery invariants stay unchanged
- `ReActIntegration` keeps continuation ownership for tool execution
- `ConversationWorker` remains the local-authoritative message seam
- gateway and IPC transport ownership lines stay unchanged
- direct-mode behavior remains the stable default and must not regress

This session does not change gateway behavior, IPC, direct vs evented execution semantics, execution/recovery design, `ToolWorker`, or `ConversationWorker`.

## Why this is the next focus

Session 53 explicitly moved the refactor focus away from local worker seam extraction and toward deeper runtime composition cleanup around singleton use and composition pressure. The codebase now has three stable local worker seams, but the surrounding runtime core still concentrates too much composition and too many hidden globals in a few places.

## Current runtime-core hotspot map

| Hotspot | Current files | Why it matters | Primary problem types |
|---|---|---|---|
| Mutable global tool surface | [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L44), [`src/gateway/gateway-server.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/gateway-server.ts#L447), [`src/infra/tools/tool-provider.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/tools/tool-provider.ts#L467), [`src/infra/prompts/prompt-provider.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/prompts/prompt-provider.ts#L31), [`src/app/conversation/response-generator.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/conversation/response-generator.ts#L68), [`src/app/lifecycle/planning/planning-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/planning/planning-service.ts#L20) | Execution and gateway both construct tool graphs and both call `setGlobalToolProvider(...)`. Prompt generation and conversation response paths read that mutable singleton indirectly. Tool visibility therefore depends on composition order rather than explicit ownership. | singleton/global-state, ownership, dependency-direction, lifecycle |
| Scheduler daemon as runtime super-root | [`src/scheduler-daemon/daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts#L87) | `SchedulerDaemon.start()` initializes repository state, startup reconciliation, agent registry loading, cron reconciliation, IPC, session intake, execution worker, scheduler construction, event forwarding, runner registration, agent scheduler loop, and retention loop in one class. | composition, lifecycle, ownership |
| Scheduler factory located under gateway integration | [`src/scheduler-daemon/daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts#L17), [`src/gateway/integration/scheduler-factory.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/scheduler-factory.ts#L58) | The scheduler daemon imports its scheduler composition function from `gateway/integration`. The factory also constructs a wide internal graph and defaults to the process-global `runtimeEventBus`. Process boundary and code boundary are still inverted. | dependency-direction, composition, singleton/global-state |
| Session intake composition facade | [`src/scheduler-daemon/session-intake.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/session-intake.ts#L139), [`src/scheduler-daemon/session-intake.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/session-intake.ts#L274) | `SchedulerSessionIntake` still owns persona loading, memory repository setup, conversation service assembly, task bridge creation, gateway-session binding cache, event publication, and conversation worker composition. | composition, ownership, lifecycle |
| Execution boundary still reaches global registries | [`src/runtime/execution-boundary/local-execution-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts#L45), [`src/infra/agents/agent-registry.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/agents/agent-registry.ts#L240), [`src/infra/agents/runner-registry.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/agents/runner-registry.ts#L36) | The execution boundary is nominally extracted, but agent-tick execution still resolves agent definitions and runners through process-global registries instead of injected runtime-owned dependencies. | singleton/global-state, dependency-direction, lifecycle |
| LLM runtime depends on gateway singleton | [`src/infra/llm/provider-manager/provider-manager.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/provider-manager/provider-manager.ts#L17), [`src/gateway/events/event-bus.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/events/event-bus.ts#L123) | The provider manager imports the global `gatewayEventBus` directly, which pulls gateway transport concerns into infra/runtime LLM code and makes non-gateway reuse harder. | dependency-direction, singleton/global-state |
| Temporary runtime event bus singleton | [`src/runtime/event-bus/runtime-event-bus.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/event-bus/runtime-event-bus.ts#L1), [`src/gateway/integration/scheduler-factory.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/scheduler-factory.ts#L67), [`src/gateway/gateway-server.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/gateway-server.ts#L67) | This singleton was an intentional migration aid. It is still a process-global event spine instance, so lifecycle ownership remains implicit even though the usage is narrower and less ambiguous than the tool-provider path. | singleton/global-state, lifecycle |

## Problem classification by type

### Composition problems

The highest composition-pressure classes are:

- `SchedulerDaemon`, which still acts as startup script, lifecycle owner, runtime assembler, and control façade
- `createScheduler(...)`, which still constructs too many scheduler concerns in one place and lives under a gateway-owned path
- `SchedulerSessionIntake`, which still composes conversation services, persistence adapters, memory services, persona resolution, event publication, and task materialization support
- `ExecutionService`, which still assembles tool registry, allowlist, enforcer, local worker, MCP registration, skill loading, and `ReActIntegration`

These are composition hotspots because they know too many concrete classes and force broad imports.

### Ownership problems

The clearest ownership ambiguity is tool-surface ownership:

- `ExecutionService` creates a tool graph and publishes it globally through `setGlobalToolProvider(...)` in [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L70)
- `GatewayServer` also creates a tool graph and publishes it globally through the same setter in [`src/gateway/gateway-server.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/gateway-server.ts#L453)
- `PromptProvider`, `PlanningService`, and `ResponseGenerator` consume the global provider rather than an explicitly owned runtime dependency

That means there is no single authoritative owner for the tool surface used by runtime-core prompting and conversation flows.

### Singleton and global-state problems

The most relevant process-global mutable state still active in runtime-core paths is:

- `globalToolProvider` in [`src/infra/tools/tool-provider.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/tools/tool-provider.ts#L467)
- `globalPromptProvider` in [`src/infra/prompts/prompt-provider.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/prompts/prompt-provider.ts#L215)
- `global` skill, agent, runner, and LLM service singletons in [`src/infra/skills/skill-registry.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/skills/skill-registry.ts#L213), [`src/infra/agents/agent-registry.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/agents/agent-registry.ts#L240), [`src/infra/agents/runner-registry.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/agents/runner-registry.ts#L36), and [`src/infra/llm/llm-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/llm-service.ts#L432)
- `runtimeEventBus` and `gatewayEventBus` in [`src/runtime/event-bus/runtime-event-bus.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/event-bus/runtime-event-bus.ts#L7) and [`src/gateway/events/event-bus.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/events/event-bus.ts#L123)

Not all of these are equally dangerous. The tool-provider path is the one where mutable global state directly changes runtime-visible capability shape.

### Dependency-direction problems

The clearest dependency-direction violations are:

- scheduler daemon importing scheduler composition from `gateway/integration`
- provider-manager importing `gatewayEventBus`
- planning and conversation prompt generation reaching tool/skill state through globals rather than runtime-owned ports

These make runtime-core depend on outer or sibling layers when the direction should move inward toward narrow runtime-owned abstractions.

### Lifecycle problems

Lifecycle ownership is still blurred in several places:

- `SchedulerDaemon.start()` and `stop()` own a large set of unrelated startup and shutdown responsibilities
- skill loading, MCP initialization, tool registration, runner registration, and cron reconciliation happen at different lifecycle points with no single runtime-core owner
- temporary singleton state can outlive or drift across test runs, embedded modes, and alternative startup orders

## The single most dangerous runtime-core hotspot

The single most dangerous remaining hotspot is the mutable global tool-provider path centered on `globalToolProvider`.

Why this is more dangerous than the other hotspots:

1. It is not just a broad composition problem. It is a mutable singleton that multiple composition roots actively overwrite.
2. It directly affects runtime behavior at the capability surface level used by planning, conversation prompting, and tool visibility.
3. It hides ownership. There is no single answer to "which tool surface is authoritative for this runtime?"
4. It creates lifecycle instability. The effective tool surface depends on which subsystem composed last in the current process.
5. It creates a broad dependency fan-out. `ExecutionService` and `GatewayServer` both know how to build the tool graph, while `PromptProvider`, `PlanningService`, and `ResponseGenerator` all depend on the side effect.

This hotspot is especially dangerous because it combines singleton state, composition pressure, and behavior-affecting hidden coupling in one place. The scheduler-factory and daemon-root issues are structurally important, but the global tool-provider path is the easiest place for a future cleanup to accidentally change runtime-visible behavior if it remains implicit.

## Candidate first-cleanup boundaries

### Option A: Start with scheduler/daemon module relocation

Move or replace `gateway/integration/scheduler-factory.ts` first.

Pros:

- improves dependency direction immediately
- makes process boundaries clearer

Cons:

- does not remove the most behavior-sensitive singleton
- risks widening into module moves and broad composition churn too early

### Option B: Start with an explicit scheduler-owned runtime tooling context

Extract a narrow runtime-core-owned tooling composition boundary that explicitly owns:

- tool registry
- tool allowlist
- tool enforcer
- tool provider/view
- skill registry handle
- MCP tool-registration lifecycle state

Pros:

- removes the most dangerous mutable global first
- keeps worker seams intact
- is additive and can preserve current tool execution semantics
- gives later scheduler-factory and prompt-provider cleanup a stable injected dependency to target

Cons:

- does not by itself fix all daemon/factory composition pressure

### Option C: Start with broad repo-wide IoC/container adoption

Pros:

- could theoretically address many singletons at once

Cons:

- far too broad for the current migration strategy
- high semantic and file-churn risk
- would violate the controlled incremental approach used so far

Recommended option: Option B.

## Safest first runtime-core cleanup model

### What should be extracted first

Extract a narrow scheduler-owned `RuntimeToolingContext` as the first runtime-core cleanup boundary.

This boundary should be a small explicit composition object created once by scheduler/runtime startup and passed to runtime-core consumers that currently rely on the global tool surface. It should become the owner of:

- the runtime-core tool graph used for execution and prompt generation
- the skill registry used by runtime-core prompting and execution
- MCP registration state for that runtime-owned tool graph

The first consumers that should read this context explicitly are:

- `ExecutionService`
- `PromptProvider`
- `PlanningService`
- `ResponseGenerator`
- `SchedulerSessionIntake` only as the runtime-core assembler that wires conversation services together

This is the safest first boundary because it replaces the highest-risk hidden dependency with explicit ownership without changing tool execution semantics. `ReActIntegration` can keep owning continuation after awaited `ToolResult`, and `LocalToolWorker` can remain the authoritative local tool seam.

### What should remain as-is for now

Keep these areas structurally unchanged in the first cleanup pass:

- `ReActIntegration` and the current tool execution continuation path
- `LocalToolWorker` request-registry and timeout behavior
- `ConversationWorker` request-registry and timeout behavior
- scheduler-owned run identity, run submission, and execution/recovery continuation invariants
- gateway IPC routing and transport handlers
- direct vs evented execution semantics
- temporary `runtimeEventBus` singleton

The reason to leave them alone is that their invariants are already intentionally stabilized and are not the main source of current composition danger.

### What should NOT be touched yet

Do not make the first runtime-core cleanup pass depend on:

- replacing `ToolWorker` or `ConversationWorker`
- changing run/result ownership
- moving to multi-process worker topology
- redesigning durable recovery or replay ownership
- changing gateway event or IPC behavior
- mass renaming or moving of modules

## Recommended extraction shape

The first extracted boundary should be runtime-core-owned and explicit, not repo-wide and not container-driven.

Suggested shape:

- `RuntimeToolingContext`
  - `toolRegistry`
  - `toolAllowlist`
  - `toolEnforcer`
  - `toolProvider`
  - `skillRegistry`
  - `initializeSkills(workspaceDir)`
  - `initializeMcpTools()`

Key design rules for that boundary:

- one runtime composition root creates it
- runtime-core code consumes it by constructor injection or narrow dependency object
- compatibility shims may temporarily mirror it into the current globals, but globals stop being the source of truth
- gateway-specific tool composition remains outside this first extraction unless it is only consuming the new boundary, not owning it

This gives runtime-core one clear owner for capability shape without changing outer transport ownership.

## Worker-line invariants that must be preserved

Any future implementation following this design must preserve:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership for tool execution
- `ConversationWorker` local-authoritative seam invariants
- current outer transport ownership lines in gateway and IPC
- direct-mode stability

The first cleanup boundary is composition-only. It must not reassign durable authority.

## What runtime-core cleanup should not do first

Do not start with any of the following tempting but premature directions:

- broad repo-wide inversion-of-control rewrite
- mass module moves or renames
- premature multi-process runtime topology changes
- replacing established worker seams
- changing durable ownership lines without need
- folding gateway transport composition into runtime-core
- redesigning execution/recovery while the current invariants are working

## Practical incremental roadmap

1. Extract runtime-core tooling ownership.
   Replace runtime-core reads/writes of the global tool-provider path with an explicit scheduler-owned tooling context while keeping behavior unchanged.
2. Re-home scheduler composition.
   After the tooling context exists, move scheduler assembly out of `gateway/integration` into a runtime-core or scheduler-owned composition location with the same behavior.
3. Narrow startup roots.
   Split `SchedulerDaemon` and `SchedulerSessionIntake` into smaller assembly units so lifecycle ownership becomes clearer without changing worker seams or transport boundaries.
4. Reduce remaining singleton reads in execution/runtime services.
   Convert agent, runner, skill, prompt, and selected LLM dependencies from hidden globals to explicit runtime-owned dependencies where this materially reduces composition pressure.

## Recommended Session 55

Session 55 should be one narrow coding session that introduces the first explicit scheduler-owned runtime tooling context and migrates runtime-core prompting/execution consumers off `globalToolProvider` as the source of truth.

Rationale:

- it addresses the single most dangerous hotspot first
- it is additive and local enough to keep behavior stable
- it preserves all established worker-line invariants
- it creates a clean foundation for the later scheduler-factory and daemon-root cleanup work

## Summary

The remaining runtime-core cleanup work should start with explicit ownership, not with topology change. The first boundary should be a scheduler-owned tooling context that removes the mutable global tool-provider path from runtime-core authority while leaving execution, recovery, gateway, IPC, and worker seams unchanged.
