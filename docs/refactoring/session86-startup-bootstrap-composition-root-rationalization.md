# Session 86: Startup/Bootstrap Composition-Root Rationalization

This session started the next major refactor block after the completed compatibility/public-surface work by reviewing only the startup/bootstrap area adjacent to the root package surfaces, gateway startup, daemon startup, and CLI startup paths, then implementing one bounded consolidation cluster.

The goal of this session was not to redesign runtime behavior. The goal was to reduce ambiguity around which modules are true startup/composition roots versus runtime-owned modules, while preserving current daemon, scheduler, replay, and public behavior.

## Reviewed Surfaces And Role Classification

| Surface | Classification | Notes |
|---|---|---|
| `src/index.ts` | compatibility/public export surface | Historical mixed root barrel. Still intentionally thin after Session 85. |
| `src/public.ts` | true public entrypoint | Intended live package surface. Not a startup/composition module. |
| `src/compatibility.ts` | compatibility/public export surface | Preserves older root-level convenience imports. Not startup-owned. |
| `src/gateway/index.ts` | compatibility/public export surface | Historical mixed gateway barrel. Thin and intentional after Sessions 83-85. |
| `src/gateway/public.ts` | true public entrypoint | Intended live gateway API surface. Not a startup module. |
| `src/gateway/compatibility.ts` | compatibility/public export surface | Intentional gateway compatibility route. |
| `src/gateway/gateway-server.ts` | mixed runtime-owned behavior with startup-adjacent assembly | This is the live gateway runtime owner, but it still contains substantial internal server assembly. That is real startup adjacency, but not the highest-value first target in this block because the daemon path still had clearer composition ambiguity. |
| `src/cli/commands/gateway.ts` | gateway startup wiring / process entrypoint | True CLI/process startup path for gateway. It constructs DB/repository/process lifecycle and then starts `GatewayServer`. |
| `src/cli/commands/scheduler-daemon.ts` | CLI startup wiring mixed with bootstrap helper behavior | True process entrypoint, but it also still duplicated default scheduler/runtime assembly for replay tooling and supplied full daemon composition state. |
| `src/scheduler-daemon/daemon.ts` | mixed startup/bootstrap and runtime-owned behavior | True daemon runtime owner, but before this session it also directly assembled `LocalExecutionAdapter`, `LocalExecutionWorker`, `SchedulerCore`, and `SchedulerSessionIntake`. |
| `src/scheduler-daemon/session-intake.ts` | runtime-owned behavior module | Scheduler-owned runtime-facing session intake facade. Already narrowed by Session 72. |
| `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts` | startup/bootstrap helper | Explicit scheduler-owned bootstrap helper for conversation runtime assembly. This is the precedent for the shape used in this session. |
| `src/scheduler/composition/index.ts` | startup/bootstrap helper | Scheduler-owned composition entrypoint, not a public package surface. |
| `src/scheduler/composition/default-scheduler.ts` | startup/bootstrap helper | Owns default `SchedulerCore` assembly; runtime behavior stays in `SchedulerCore` and downstream modules. |
| `src/gateway/integration/compatibility.ts` | compatibility/public export surface | Thin compatibility route only. Not startup-owned. |
| `src/gateway/integration/scheduler-compatibility.ts` | compatibility/public export surface | Thin scheduler historical import route. Not active startup debt. |

## Selected Consolidation Cluster

The highest-value first cluster was the scheduler-daemon startup path:

- `src/cli/commands/scheduler-daemon.ts`
- `src/scheduler-daemon/daemon.ts`
- a new startup-only helper under `src/scheduler-daemon/bootstrap/`

This cluster was chosen because it contained the clearest still-live composition-root ambiguity:

- the CLI command was a real process entrypoint, but it also duplicated default scheduler/runtime assembly for replay tooling
- `SchedulerDaemon` was a real runtime-owned module, but it still directly assembled startup-only pieces such as the execution worker, default scheduler composition, and session-intake bootstrap
- those responsibilities were startup/bootstrap concerns, not steady-state daemon behavior concerns

This was a better first move than pushing on gateway internals because the daemon path had both a real ownership mismatch and a contained, behavior-preserving extraction available immediately.

## What Changed

Added `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` as an explicit daemon startup/bootstrap module.

That new helper now owns:

- default scheduler runtime assembly via `createDefaultSchedulerDaemonRuntime(...)`
- default session-intake bootstrap via `createSchedulerDaemonSessionIntake(...)`

`src/scheduler-daemon/daemon.ts` no longer directly constructs:

- `LocalExecutionAdapter`
- `LocalExecutionWorker`
- `createDefaultScheduler(...)`
- `SchedulerSessionIntake` via inline `getLLMService()` startup wiring

Instead, `SchedulerDaemon` now:

- remains the daemon runtime lifecycle owner
- acquires locks, connects IPC, starts/stops the control server, subscribes to scheduler/debug events, runs reconciliation/recovery, and owns active-loop lifecycle
- delegates default runtime assembly and session-intake bootstrap to the new startup-only helper

`src/cli/commands/scheduler-daemon.ts` was also rerouted so the replay-only startup path now uses the same `createDefaultSchedulerDaemonRuntime(...)` helper instead of duplicating default scheduler/execution-worker assembly inline.

## Resulting Surface Distinction

After this session, the startup/bootstrap distinction is clearer:

- public entrypoints remain `src/public.ts` and `src/gateway/public.ts`
- compatibility/public export surfaces remain `src/index.ts`, `src/compatibility.ts`, `src/gateway/index.ts`, `src/gateway/compatibility.ts`, and gateway integration compatibility modules
- CLI entrypoints remain the process startup owners for gateway and scheduler daemon commands
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` is now the explicit daemon startup/bootstrap assembly module
- `src/scheduler-daemon/daemon.ts` is more clearly the daemon runtime lifecycle owner rather than the default composition root
- `src/scheduler-daemon/session-intake.ts` remains runtime-owned behavior rather than startup wiring

## What Remains And Why

The following surfaces remain intentionally unchanged in this session:

- `src/index.ts`, `src/public.ts`, `src/compatibility.ts`: already rationalized in Session 85; moving them again would reopen closed compatibility/public-surface work
- `src/gateway/index.ts`, `src/gateway/public.ts`, `src/gateway/compatibility.ts`: same reason
- `src/gateway/gateway-server.ts`: still mixes runtime ownership with internal startup-adjacent assembly, but that is a separate consolidation candidate and should be reviewed as its own bounded follow-up rather than widened into this daemon cluster
- `src/cli/commands/gateway.ts`: remains the gateway process entrypoint; no gateway behavior changes were needed for this daemon-first cleanup

## Intentionally Postponed

- any gateway startup/bootstrap extraction from `src/gateway/gateway-server.ts`
- any broad package-entrypoint redesign
- any compatibility surface deletion
- any daemon behavior redesign
- any scheduler behavior redesign
- any replay protocol or control-path redesign

## Block Status

This new startup/bootstrap composition-root line now looks like a multi-session block rather than a one-session close.

This session removed one meaningful daemon-side composition ambiguity, but the gateway startup path still has a comparable review/cleanup opportunity after the daemon shape is documented and validated.

## Preserved Invariants

This session preserved:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- ToolWorker local-authoritative seam invariants
- ConversationWorker local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `LLMStreamEventSink` ownership direction
- extracted conversation bootstrap ownership
- scheduler composition ownership established during RF-034
- gateway/daemon transport-boundary ownership established in Sessions 78-82
- compatibility/public-surface split established in Sessions 83-85
- outer transport ownership lines
- durable ownership lines
- current scheduler behavior
- current daemon startup behavior
- current replay behavior
- current direct vs evented execution semantics
- current `runtimeEventBus` semantics and ownership
- current persistence semantics
- current public runtime behavior
- current attach/connect and detach/unsubscribe semantics

## Validation Summary

Targeted validation run:

- `npx jest test/scheduler-daemon/daemon-runtime-tooling-context.test.ts test/scheduler-daemon/daemon-startup-reconciliation.test.ts test/scheduler-daemon/daemon-manual-replay-control.test.ts`

Additional focused review:

- import/usage scan confirmed the replay CLI helper and live daemon startup path now route default scheduler/execution-worker assembly through the same daemon bootstrap helper

No runtime-semantics changes were intended in this session. The refactor only relocated default startup assembly.

## Recommended Next Session

Stay inside the same startup/bootstrap composition-root block and review the gateway startup path as the next likely consolidation target.

The best next bounded move appears to be a focused gateway-side startup extraction that distinguishes:

- gateway process entrypoint wiring in `src/cli/commands/gateway.ts`
- any startup-only assembly helper that should sit adjacent to gateway startup
- runtime-owned behavior that should remain in `src/gateway/gateway-server.ts`

The next session should not widen into broader barrel cleanup or daemon behavior redesign.
