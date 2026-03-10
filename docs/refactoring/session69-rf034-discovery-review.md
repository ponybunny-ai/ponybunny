# Session 69: RF-034 Discovery Review

## Scope

This session is a documentation-only discovery/design review for `RF-034`.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution/recovery
- redesign `ToolWorker`
- redesign `ConversationWorker`
- implement runtime-core cleanup code
- perform broad module moves or renames

## Review basis

This review is based on:

- the Session 53, 54, 58, and 68 closure/design documents
- current non-execution composition and dependency structure in:
  - `src/infra/llm/provider-manager/provider-manager.ts`
  - `src/scheduler-daemon/session-intake.ts`
  - `src/gateway/integration/scheduler-factory.ts`
  - adjacent composition callers in `src/scheduler-daemon/daemon.ts` and `src/cli/commands/scheduler-daemon.ts`

## What is explicitly not the next target

The following lines should not be casually reopened as the next architectural cleanup target:

- `RF-033` execution/runtime cleanup
- the `ToolWorker` seam
- the `ConversationWorker` seam

Why not:

- Session 68 already concluded the execution/runtime line no longer has one obvious next isolated knot; reopening it now would likely broaden into execution-lifecycle redesign, runtime-tooling redesign, or recovery redesign instead of a safe dependency-direction cleanup.
- Session 45 already closed the `ToolWorker` line for its current local-authoritative scope.
- Session 53 already closed the `ConversationWorker` line for its current local-authoritative scope.

Those lines should only be revisited if a new, narrower explicit problem statement emerges. None of the current highest-value non-execution issues require reopening their established semantics.

## Current highest-value RF-034 candidate set

Three remaining problems stand out outside the stabilized execution/runtime path.

### A. `LLMProviderManager` streaming telemetry depends directly on gateway event infrastructure

Relevant code:

- `src/infra/llm/provider-manager/provider-manager.ts:17`
- `src/infra/llm/provider-manager/provider-manager.ts:377-552`
- `src/gateway/events/event-bus.ts:124`

Current shape:

- `LLMProviderManager` in `src/infra` imports the concrete gateway singleton `gatewayEventBus`.
- The streaming path emits `llm.stream.start`, `llm.stream.chunk`, `llm.stream.end`, and `llm.stream.error` directly from the provider manager.

Issue classification:

- true import/back-edge problem: yes
- infra-hub concentration problem: moderate
- constructor/composition pressure knot: low to moderate
- source-of-truth / ownership-direction smell: yes

Why this matters now:

- This is the clearest remaining non-execution dependency-direction violation in the reviewed code. Infrastructure-level LLM transport code reaches upward into gateway event delivery concerns.
- It makes gateway event semantics an implicit dependency of a provider/fallback component that should be reusable without gateway presence.
- It keeps outer transport/observation ownership blurred: the provider manager is not only producing completions, it also decides how gateway-facing streaming telemetry is published.

What it threatens if left untouched:

- outer transport ownership lines, because gateway event publication continues to leak inward
- future gateway/daemon seam cleanup, because infra code still assumes a gateway singleton exists
- safe isolation of `src/infra` concerns, because the most reusable LLM path still has a concrete back-edge into `src/gateway`

### B. `SchedulerSessionIntake` remains a scheduler-side conversation composition hub

Relevant code:

- `src/scheduler-daemon/session-intake.ts:14-30`
- `src/scheduler-daemon/session-intake.ts:295-351`

Current shape:

- `SchedulerSessionIntake` constructs `PersonaEngine`, session/memory repositories, `LocalEmbeddingService`, `CoreMemorySummaryService`, `ConversationMemoryService`, `InputAnalysisService`, `ResponseGenerator`, `RetryHandler`, `SchedulerTaskBridge`, `SessionManager`, and the default `ConversationWorker`.
- It also loads runtime config, resolves agent-model hints, reads filesystem-backed agent config, and creates an empty `ToolRegistry` / `ToolAllowlist` / `ToolEnforcer` inline for conversation response generation.

Issue classification:

- true import/back-edge problem: no direct cycle found
- infra-hub concentration problem: yes
- constructor/composition pressure knot: yes
- source-of-truth / ownership-direction smell: yes

Why this matters now:

- This is the biggest remaining non-execution constructor hub on the scheduler-side conversation path.
- It concentrates conversation bootstrap, memory bootstrap, persona bootstrap, runtime-config reads, and default worker composition in one class that also owns session lifecycle operations.
- The inline empty tool-registry/enforcer construction sits awkwardly beside `RuntimeToolingContext` being the authoritative migrated runtime-owned tooling source on migrated paths.

What it threatens if left untouched:

- `ConversationWorker` local-authoritative seam invariants, because the class above the worker still carries too much bootstrap authority and can easily absorb more policy/dispatch behavior
- `RuntimeToolingContext` source-of-truth rules on migrated paths, because conversation bootstrap still partly fabricates tooling-related collaborators locally instead of consuming one narrow explicit conversation composition input
- future safe conversation bootstrap cleanup, because the current hub encourages more “just add one more dependency here” growth

### C. `gateway/integration/scheduler-factory.ts` is a cross-domain composition owner in the wrong place

Relevant code:

- `src/gateway/integration/scheduler-factory.ts:7-29`
- `src/gateway/integration/scheduler-factory.ts:58-185`

Current shape:

- A file under `src/gateway/integration/` constructs `SchedulerCore`, scheduler support services, repository adapters, quality gate wiring, runtime event bus defaults, and default `LocalExecutionAdapter`.
- It is used by scheduler-side entry points even though its namespace implies gateway ownership.

Issue classification:

- true import/back-edge problem: not a literal cycle in the reviewed files
- infra-hub concentration problem: moderate
- constructor/composition pressure knot: yes
- source-of-truth / ownership-direction smell: yes

Why this matters now:

- The scheduler composition root currently lives under a gateway-named package, which encodes the wrong architectural ownership signal.
- It makes transport/process-boundary cleanup harder later because scheduler assembly still looks gateway-owned in module layout even when the scheduler daemon is the actual consumer.

What it threatens if left untouched:

- outer transport ownership lines, because scheduler construction remains coupled to gateway-oriented integration naming and placement
- future gateway/daemon seam cleanup, because any change here is easy to mix with transport concerns instead of staying inside pure scheduler composition

## Single highest-value first RF-034 target

The single highest-value first `RF-034` target should be:

`LLMProviderManager`'s direct dependency on `gatewayEventBus` for streaming telemetry publication.

Why this one should be first:

- It is the clearest real dependency-direction bug, not just a large constructor.
- It is narrow enough to clean up without reopening gateway behavior, IPC, conversation semantics, worker seams, or execution/recovery semantics.
- It removes an actual `src/infra` -> `src/gateway` concrete back-edge, which is more architecturally valuable per unit of risk than starting with a broader composition hub extraction.
- It creates a cleaner foundation for later `RF-034` work on session-intake and scheduler composition, because those later cleanups can then operate without preserving this transport-facing leak inside LLM infrastructure.

Why the other candidates should not go first:

- `SchedulerSessionIntake` is high-value, but a first pass there is larger and easier to accidentally broaden into conversation bootstrap redesign, memory bootstrap redesign, or `ConversationWorker` seam reopening.
- `gateway/integration/scheduler-factory.ts` is real ownership-direction debt, but touching it first risks pulling gateway/process-boundary concerns into scope too early.

## Safest first cleanup model

The safest first cleanup model for the selected target is:

introduce a narrow injected LLM streaming event sink boundary between provider-manager streaming internals and gateway event publication.

### Boundary to introduce or tighten

Introduce a small runtime-agnostic sink interface near the provider-manager layer, for example an `LLMStreamEventSink` with methods equivalent to:

- `streamStarted(...)`
- `streamChunk(...)`
- `streamEnded(...)`
- `streamErrored(...)`

This boundary should be optional and default to a no-op implementation.

### What should be extracted

- Extract only the gateway-event publication calls out of `LLMProviderManager.callEndpointStreaming(...)`.
- Move concrete `gatewayEventBus.emit(...)` mapping into a gateway-owned adapter or composition-time binding.

### What should stay in place

- provider/model selection
- fallback behavior
- endpoint health logic
- streaming request/response parsing
- `options.onChunk`, `options.onComplete`, and `options.onError` callback behavior
- existing event names and payload shape for current gateway consumers

### What should not be touched yet

- no provider-manager redesign
- no endpoint-manager redesign
- no gateway event protocol redesign
- no runtime event-bus migration for LLM streaming in the same step
- no scheduler-daemon/session-intake extraction in the same step
- no file moves or namespace renames in the first cleanup

This keeps the first `RF-034` coding step as a dependency-direction repair, not a telemetry redesign.

## Preserved invariants

Any `RF-034` work started from this review should explicitly preserve:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` local-authoritative seam invariants
- `ConversationWorker` local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated runtime-owned paths
- outer transport ownership lines
- durable ownership lines

For the recommended first target specifically, that means:

- no change to direct vs evented execution behavior
- no change to how gateway clients receive streamed content
- no change to provider fallback or health semantics
- no change to conversation or execution call sites beyond passing/binding a sink dependency

## Why the other findings still matter

The first target above should not hide the next-most-important follow-up pressure.

### `SchedulerSessionIntake` should likely be the second RF-034 track

After the provider-manager back-edge is removed, the next best target is probably a narrow conversation-bootstrap factory/builder extraction from `SchedulerSessionIntake`.

That would be aimed at:

- reducing constructor concentration
- stopping local recreation of tooling-adjacent collaborators next to `RuntimeToolingContext`
- preserving the current `ConversationWorker` seam while shrinking the hub above it

### `scheduler-factory.ts` should remain a later ownership cleanup

It should be treated as a later composition-root ownership cleanup, not a first move.

The likely safe version later is:

- introduce a scheduler-owned composition module
- keep the same assembled dependencies and defaults
- avoid any gateway, IPC, or process-topology changes in that extraction

## What RF-034 should not do first

RF-034 should not begin with:

- a broad repo-wide layering rewrite
- broad container/IoC introduction
- worker seam redesign
- transport ownership changes
- gateway event protocol redesign
- reopening `RF-033` without a new narrow problem statement
- broad module moves or namespace renames
- collapsing `SchedulerSessionIntake`, `SessionManager`, and `ConversationWorker` into a new conversation architecture
- moving scheduler ownership into `GatewayServer` or moving gateway routing ownership into scheduler-side classes

Why these are premature in the current codebase:

- the highest-value first issue is already narrow and concrete
- the current worker seams are stable and should be preserved
- the current execution/runtime line is stable enough to pause
- the reviewed remaining problems are mostly ownership-direction and composition-root issues, not evidence that the whole layering model needs replacement

## Ordered RF-034 roadmap

1. Remove the concrete `LLMProviderManager` -> `gatewayEventBus` back-edge by introducing an injected streaming event sink boundary with a gateway adapter.
2. Extract a narrow scheduler-side conversation bootstrap/composition boundary from `SchedulerSessionIntake` while leaving `ConversationWorker`, `SessionManager`, and current behavior intact.
3. Re-home or wrap scheduler assembly so scheduler composition is no longer owned by `src/gateway/integration/`, without changing transport/process topology.

That is enough roadmap for now. Anything broader should wait until one of those phases exposes a new explicit problem statement.

## Recommended Session 70

Session 70 should be one single coding session that removes the direct `LLMProviderManager` dependency on `gatewayEventBus` by introducing a narrow injected streaming event sink/adapter boundary.

Rationale:

- it addresses the clearest true back-edge now present outside the stabilized execution/runtime path
- it is the safest dependency-direction fix available
- it improves `RF-034` without disturbing gateway behavior, IPC, worker seams, or execution/recovery invariants

## Conclusion

`RF-034` should start with the narrowest real dependency-direction win, not with the largest remaining class.

Right now that first win is the provider-manager streaming telemetry back-edge into gateway event infrastructure. `SchedulerSessionIntake` and scheduler composition placement remain important follow-up cleanup targets, but they should come after the true back-edge is removed so that later work starts from a cleaner directionality baseline instead of from another cross-layer exception.
