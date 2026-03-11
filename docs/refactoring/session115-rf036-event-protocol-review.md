# Session 115: RF-036 Event Protocol Review

## Scope

Session 115 starts `RF-036` as a bounded review/design session only.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused Sessions 95-100, 101-103, 104-109, `RF-062`, or `RF-030`
- redesign scheduler semantics
- redesign conversation lifecycle semantics
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport semantics
- change provider execution/fallback behavior
- change TUI behavior
- perform broad package/module-boundary redesign

## Files Reviewed

Primary files reviewed:

- `src/scheduler/core/scheduler.ts`
- `src/runtime/workers/execution-worker.ts`
- `src/gateway/types.ts`
- `src/gateway/integration/scheduler-bridge.ts`
- `src/gateway/integration/ipc-bridge.ts`
- `src/gateway/events/broadcast-manager.ts`
- `src/cli/tui/app.tsx`
- `src/runtime/event-bus/adapters/scheduler-event-adapter.ts`
- `src/runtime/event-bus/adapters/gateway-event-adapter.ts`

Supporting evidence was also gathered with repository-wide searches for live `task.*` producers/consumers.

## Current Live `task.*` Protocol Paths

### Path 1: evented scheduler-to-worker execution dispatch

This is the only currently live, authoritative `task.*` runtime path found in the codebase.

Current flow:

1. In evented execution mode, `SchedulerCore.publishTaskReady(...)` builds the normalized `ExecutionRequest`, persists the `evented_dispatch` checkpoint into run context, and publishes runtime event `task.ready` with that full request as the payload in `src/scheduler/core/scheduler.ts`.
2. `LocalExecutionWorker.start()` subscribes directly to `task.ready` in `src/runtime/workers/execution-worker.ts`.
3. `LocalExecutionWorker.handleTaskReady(...)` validates that the payload is an `ExecutionRequest`, suppresses duplicate `runId`s in memory, then executes through `ExecutionPort`.
4. The worker publishes `execution.started`, `execution.completed`, or `execution.failed`.
5. `SchedulerCore` subscribes to runtime events and, in evented mode, consumes `execution.completed` / `execution.failed` as the authoritative completion path.

Important current meaning:

- `task.ready` is not a user-facing progress event.
- `task.ready` is a runtime dispatch command carrying the scheduler-owned execution boundary request.
- The authoritative success/failure protocol after dispatch is already `execution.*`, not `task.*`.

### Path 2: scheduler status events to gateway and TUI

The live gateway/TUI path does not use `task.*` names for scheduler progress/result reporting.

Current flow:

1. `SchedulerCore` emits scheduler events with underscored names such as `work_item_started`, `work_item_in_progress`, `run_started`, and `run_completed`.
2. `SchedulerBridge` maps those events to gateway event-bus names such as `workitem.started`, `workitem.in_progress`, `run.started`, and `run.completed` in direct/in-process mode.
3. `IPCBridge` performs the same mapping when the scheduler daemon sends `scheduler_event` messages to the gateway.
4. `BroadcastManager` broadcasts `goal.*`, `workitem.*`, `run.*`, `verification.*`, `budget.*`, `escalation.*`, conversation, channel, and LLM stream events to clients.
5. The TUI consumes those `goal.*`, `workitem.*`, `run.*`, and `verification.completed` events as the live status/result path.

Important current meaning:

- Gateway/TUI progress and result semantics are already centered on `goal.*`, `workitem.*`, `run.*`, and `verification.*`.
- That live transport-facing vocabulary is separate from the runtime-internal `task.ready` command path.

### Path 3: gateway/TUI `task.*` compatibility residue

The gateway type surface and TUI still contain `task.*` event handling, but no live producer path was found for those events in the current codebase.

Current evidence:

- `src/gateway/types.ts` still includes `task.narration` and `task.result` in `GatewayEventType`.
- `src/cli/tui/app.tsx` still has `case 'task.narration'` and `case 'task.result'` branches.
- `src/gateway/events/broadcast-manager.ts` does not subscribe/broadcast either `task.narration` or `task.result`.
- `src/gateway/integration/scheduler-bridge.ts` and `src/gateway/integration/ipc-bridge.ts` do not emit either event.
- Repository-wide search found no current `emit(...)`, `publish(...)`, or bridge path producing `task.narration` or `task.result` in `src/`.

Current meaning:

- These are legacy compatibility surfaces, not the authoritative live gateway protocol.
- They remain visible to type consumers and to the TUI event switch, so the codebase still presents them as if they were active.

## Current Variant/Shape Inventory

### Live `task.*` runtime event

- `task.ready`
- producer: `SchedulerCore`
- consumer: `LocalExecutionWorker`
- payload shape: full `ExecutionRequest`
- layer: runtime-internal dispatch command

### Live successor result events on the same runtime seam

- `execution.started`
- `execution.completed`
- `execution.failed`
- producer: `LocalExecutionWorker`
- consumer: `SchedulerCore` for `execution.completed` / `execution.failed`
- payload shape: `{ request }`, `{ request, result }`, `{ request, error, result }`
- layer: runtime-internal execution result protocol

### Live gateway/TUI status/result events

- `goal.*`
- `workitem.*`
- `run.*`
- `verification.*`
- producer chain: scheduler events -> `SchedulerBridge` or `IPCBridge` -> gateway event bus -> `BroadcastManager`
- consumer: TUI and other gateway clients
- layer: transport/public-facing status and observation protocol

### Legacy compatibility-only `task.*` gateway events

- `task.narration`
- `task.result`
- producer: none found in live `src/` code paths
- consumer: TUI compatibility branches, plus any external clients depending on the declared gateway type union
- layer: stale public/compatibility residue

## Where Meaning or Naming Is Blurred

### `task.*` means different things in different layers

- `task.ready` is an internal execution command.
- `task.narration` and `task.result` are user-facing progress/result labels.
- Those meanings share the same `task.*` prefix even though they belong to different protocol families.

### The live gateway protocol no longer matches the declared gateway `task.*` surface

- Runtime-internal execution dispatch uses `task.ready`.
- Gateway/TUI live status/result transport uses `goal.*`, `workitem.*`, and `run.*`.
- Gateway typing still exposes `task.narration` / `task.result` as if they were part of the current live transport vocabulary.

### The runtime event bus also carries multiple normalized vocabularies

- `SchedulerEventAdapter` republishes scheduler events as runtime `workitem.*`, `run.*`, `verification.*`, and budget events.
- `GatewayEventAdapter` republishes gateway events back onto the runtime bus using the same transport-facing names.
- Meanwhile the evented execution seam still uses `task.ready` plus `execution.*`.

That does not make the runtime bus incorrect, but it does show that `task.*` is no longer a coherent top-level family across layers.

## Issue Classification

### Event naming drift

- The historical `task.*` family no longer represents a single end-to-end lifecycle.
- Runtime dispatch still says `task.ready`, while gateway/TUI live observation uses `workitem.*` and `run.*`.

### Protocol meaning drift

- `task.ready` is an imperative dispatch request carrying an `ExecutionRequest`.
- `task.narration` / `task.result` imply user-facing observation/result updates.
- The same prefix now mixes command semantics with presentation semantics.

### Layer-specific overload of shared event names

- Runtime worker code treats `task.ready` as a strict machine-to-machine contract.
- Gateway/TUI compatibility code treats `task.*` as a client-facing UX event family.

### Compatibility residue

- `task.narration` and `task.result` remain in gateway public typing and TUI handling even though no live gateway publisher currently emits them.

### Typing/public-surface mismatch

- `GatewayEventType` advertises `task.narration` / `task.result`.
- `BroadcastManager` does not route them, and the bridge layers do not emit them.
- The public type surface therefore overstates the actual live protocol.

### Producer/consumer coupling through legacy event vocabulary

- `LocalExecutionWorker` is hard-wired to subscribe to `task.ready`.
- Replay/evented-dispatch design and tests also still assume `task.ready`.
- That coupling makes internal renaming possible, but not the safest first normalization slice.

## Plausible First Normalization Slices

Only slices grounded in the current codebase are included here.

### Slice A: separate legacy gateway `task.narration` / `task.result` from the authoritative live gateway protocol

What it means:

- treat `task.narration` / `task.result` as explicit compatibility-only gateway events rather than authoritative live transport events
- keep compatibility handling available where needed
- make the authoritative gateway/TUI protocol be the actually produced `goal.*`, `workitem.*`, `run.*`, and `verification.*` events

Evaluation:

- Structural gain: high. It cleanly separates live transport protocol from dead/stale compatibility vocabulary.
- Semantic risk: low. No scheduler, runtime worker, transport, or UI behavior needs to change if compatibility handling is retained.
- Scope tightness: high. The affected seam is concentrated in gateway typing and TUI event consumption.
- True protocol/boundary cleanup: yes. This is a public-surface and consumer-boundary normalization, not a cosmetic rename.
- Drift risk: low. It does not require transport rewrite, UI redesign, or broad schema rewriting.

Judgment:

This is the strongest first slice.

### Slice B: normalize the internal `task.ready` seam behind an explicit execution-command name while retaining compatibility

What it means:

- introduce a more explicit internal execution dispatch name or boundary ownership around the current `task.ready` payload
- retain compatibility publication/subscription for `task.ready` during migration

Evaluation:

- Structural gain: moderate to high. It would make the scheduler-worker seam more semantically explicit.
- Semantic risk: medium. `task.ready` is tied to evented replay, checkpoint/recovery reasoning, tests, and the live event store.
- Scope tightness: moderate. A safe change would need scheduler, worker, tests, and compatibility handling together.
- True protocol/boundary cleanup: yes.
- Drift risk: moderate. This can slide into broader runtime event-schema rewrite if not tightly constrained.

Judgment:

Valuable, but not the best first cut while the codebase still has easier gateway-facing compatibility residue to isolate.

### Slice C: tighten gateway typing only, without classifying a compatibility boundary

What it means:

- simply remove or narrow `task.narration` / `task.result` from `GatewayEventType`

Evaluation:

- Structural gain: low to moderate by itself.
- Semantic risk: low to medium depending on external client assumptions.
- Scope tightness: high.
- True protocol/boundary cleanup: only partial. Without an explicit compatibility story, this is just surface trimming.
- Drift risk: low.

Judgment:

Too weak as a stand-alone target. The value comes from separating authoritative versus compatibility protocol, not from type pruning alone.

## Highest-Value First Target

The highest-value first RF-036 target is:

### Separate legacy gateway-facing `task.narration` / `task.result` compatibility events from the authoritative live gateway event protocol

Current problematic seam:

- `src/gateway/types.ts` still declares `task.narration` and `task.result` as normal `GatewayEventType` members.
- `src/cli/tui/app.tsx` still handles them as if they are part of the live event stream.
- But the live gateway publication path in `src/gateway/integration/scheduler-bridge.ts`, `src/gateway/integration/ipc-bridge.ts`, and `src/gateway/events/broadcast-manager.ts` does not emit or broadcast them.

Where it lives:

- gateway public typing
- gateway client/TUI event-consumption boundary
- not in the scheduler-worker runtime dispatch seam

Who should own the authoritative meaning instead:

- the authoritative transport-facing task/progress/result meaning should remain with the currently live gateway event family:
  - `goal.*`
  - `workitem.*`
  - `run.*`
  - `verification.completed`
- any remaining `task.narration` / `task.result` support should be explicitly compatibility-only at the gateway-client consumption edge, not treated as first-class live protocol.

Why this is the best first cut:

- it fixes a real current mismatch between declared public protocol and actual live producers
- it is tightly bounded and semantics-preserving
- it reduces protocol ambiguity without touching evented execution, replay, scheduler semantics, or transport wiring
- it gives RF-036 a concrete normalization win before tackling the riskier internal `task.ready` seam

What must remain untouched for semantics safety:

- `SchedulerCore` publishing of `task.ready`
- `LocalExecutionWorker` subscription to and parsing of `task.ready`
- `execution.completed` / `execution.failed` result ownership
- scheduler event emission semantics
- gateway/daemon transport behavior
- TUI user-visible behavior
- provider execution/fallback behavior

## What Is Not Next

- broad event-bus redesign
- transport rewrite
- TUI UX redesign
- scheduler-core redesign
- runtime worker redesign
- repo-wide renaming for cosmetics
- reopening paused lines
- changing `task.ready` semantics in the same first slice

## Practical RF-036 Roadmap

### Phase 1

Isolate gateway/TUI `task.narration` and `task.result` as explicit compatibility-only surfaces while keeping current behavior intact.

### Phase 2

After the compatibility residue is isolated, reassess whether the internal `task.ready` scheduler-to-worker seam should gain an explicit authoritative execution-command name with a compatibility shim.

### Phase 3

Only after the first two slices land, reassess whether any remaining runtime-bus duplication or cross-layer vocabulary overlap still justifies further RF-036 work.

## Recommended Session 116

Recommend exactly one next session:

Implement one bounded coding session that separates gateway/TUI `task.narration` and `task.result` into an explicit compatibility-only boundary while preserving current runtime, transport, and TUI behavior.

That is the strongest semantics-preserving first implementation cut for `RF-036`.

## Validation

Validation for Session 115 was review-oriented:

- reviewed the live scheduler evented dispatch path in `src/scheduler/core/scheduler.ts`
- reviewed the live worker subscription/result path in `src/runtime/workers/execution-worker.ts`
- reviewed live gateway typing in `src/gateway/types.ts`
- reviewed the direct scheduler-to-gateway mapping in `src/gateway/integration/scheduler-bridge.ts`
- reviewed the daemon IPC scheduler-to-gateway mapping in `src/gateway/integration/ipc-bridge.ts`
- reviewed gateway broadcast coverage in `src/gateway/events/broadcast-manager.ts`
- reviewed TUI event consumption in `src/cli/tui/app.tsx`
- reviewed adjacent runtime event adapters in `src/runtime/event-bus/adapters/scheduler-event-adapter.ts` and `src/runtime/event-bus/adapters/gateway-event-adapter.ts`
- ran repository-wide searches for live `task.*` producers/consumers to confirm that `task.narration` / `task.result` have no current gateway publication path in `src/`

No runtime source files were changed in this session.
