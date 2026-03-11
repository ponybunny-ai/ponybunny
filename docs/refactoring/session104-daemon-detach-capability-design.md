# Session 104: Daemon Detach/Unsubscribe Capability Design

## Scope

Session 104 is a bounded design/review session for the next major block:

- daemon detach/unsubscribe capability design

This session uses the actual current codebase to define the structural baseline, separate the meanings of detach and unsubscribe, and select one safest first future capability slice.

This session does not implement runtime behavior changes.

## Reviewed Surfaces

Primary reviewed surfaces:

- `src/gateway/integration/gateway-daemon-detach-operations.ts`
- `src/gateway/integration/gateway-daemon-attachment.ts`
- `src/gateway/integration/gateway-daemon-lifecycle.ts`
- `src/gateway/integration/daemon-event-forwarding.ts`
- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/runtime/gateway-runtime-rpc-surface.ts`
- `src/gateway/gateway-server.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `src/gateway/connection/session.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/gateway/rpc/handlers/debug-handlers.ts`
- `docs/refactoring/session82-detach-operation-boundary-closure-attempt.md`
- `docs/refactoring/session103-runtime-core-singleton-line-review.md`

## Current Structural Baseline

### What daemon attachment currently means

In the current code, daemon attachment is a gateway-owned coordination concept, not a daemon lifecycle command.

- `GatewayDaemonAttachment.connect(daemon)` in `src/gateway/integration/gateway-daemon-attachment.ts` does three things:
  - rejects a second attach attempt with a warning if a daemon is already attached
  - calls `registerDaemonEventForwarders(this.eventBus, daemon)`
  - records the attached daemon reference and `connectedAt` timestamp through `GatewayDaemonLifecycle.attach(...)`
- `GatewayDaemonLifecycle` in `src/gateway/integration/gateway-daemon-lifecycle.ts` stores only:
  - one `IDaemonEventEmitter | null`
  - one `connectedAt` timestamp
  - a derived status projection with `phase: 'detached' | 'attached'` and `connected: boolean`

So today, "attached" means:

- the gateway has accepted one daemon event source reference
- gateway-owned forwarding callbacks have been registered against that daemon event source
- the gateway lifecycle snapshot now reports `connected: true`

It does not mean:

- the daemon process is controllably detachable
- subscriptions can be removed
- runtime execution is paused or stopped
- IPC connectivity has changed
- the daemon can be reattached after an explicit detach, because no detach path exists yet

### What detach-facing operation state is currently exposed

The explicit detach-facing state lives in `src/gateway/integration/gateway-daemon-detach-operations.ts`.

- `GatewayDaemonDetachPhase = 'idle' | 'attached-awaiting-daemon-unsubscribe'`
- `GatewayDaemonDetachStatus` exposes:
  - `phase`
  - `attached`
  - `detachSupported: false`
  - `unsubscribeSupported: false`
- `GatewayDaemonAttachment` exposes:
  - `getDetachStatus()`
  - `getOperationState()`

The current derivation is deliberately descriptive only:

- unattached lifecycle state -> `phase: 'idle'`, `attached: false`
- attached lifecycle state -> `phase: 'attached-awaiting-daemon-unsubscribe'`, `attached: true`

That phase name is important. It already encodes the current structural truth that a meaningful detach would require daemon-side unsubscription first, but the code still marks both detach and unsubscribe as unsupported.

### What is explicitly unsupported today

The current code makes several unsupported facts explicit:

- there is no detach method on `GatewayDaemonAttachment`
- there is no gateway-owned detach command surface in RPC/control-plane code
- there is no unsubscribe handle returned from `registerDaemonEventForwarders(...)`
- `IDaemonEventEmitter` in `src/autonomy/daemon-event-emitter.ts` only offers add-only `on...` registration methods returning `void`
- `DaemonEventEmitterMixin` only pushes callbacks into arrays; it does not expose callback removal

This means real detach/unsubscribe capability cannot be implemented purely as a gateway-side status change. The daemon/runtime event-source contract would need a releasable subscription seam first.

### Which layer currently owns the detach-facing boundary

The detach-facing boundary is currently owned by the gateway integration layer:

- ownership home: `GatewayDaemonAttachment` + `GatewayDaemonLifecycle` + `gateway-daemon-detach-operations`
- transport/status projection consumer: `GatewayRuntimeRpcSurface.getGatewayStatusSnapshot()`
- broader gateway status consumer: `GatewayServer.getGatewayStatusSnapshot()`

`system.status`-style reporting consumes the projected state; it does not own detach semantics.

### Transport projection vs gateway-owned coordination vs daemon/runtime behavior

Current responsibilities are already split in a useful way:

| Surface | Current role |
|---|---|
| `src/gateway/runtime/gateway-runtime-rpc-surface.ts` and `GatewayServer.getGatewayStatusSnapshot()` | transport/control-plane projection of current attachment and detach-facing status |
| `src/gateway/integration/gateway-daemon-attachment.ts` and `src/gateway/integration/gateway-daemon-lifecycle.ts` | gateway-owned coordination and attachment bookkeeping |
| `src/gateway/integration/daemon-event-forwarding.ts` | gateway-owned event translation from daemon callbacks onto the gateway event bus |
| `src/autonomy/daemon-event-emitter.ts` | daemon/runtime-owned callback registration and event emission contract |

That split should remain intact. The next block should add capability at the seam between gateway-owned attachment coordination and daemon-owned callback registration, not reopen transport ownership or runtime graph work.

## Concept Separation

The following concepts must remain distinct.

### Detach

Detach is a gateway-owned attachment operation.

For this block, detach should mean:

- the gateway intentionally ends its current logical attachment to one daemon event source
- gateway-owned forwarding from that daemon into the gateway event bus is released
- gateway lifecycle state changes from attached to detached

Detach should not, by itself, mean stopping daemon execution, killing a process, changing scheduler behavior, or redefining event schemas.

### Unsubscribe

Unsubscribe is release of a previously registered event subscription/binding.

For this block, the relevant unsubscribe meaning is:

- gateway forwarders unsubscribe from the daemon event emitter callbacks they previously registered

This is not the same as existing WebSocket-session subscription APIs such as:

- `goal.unsubscribe` in `src/gateway/rpc/handlers/goal-handlers.ts`
- `debug.events.unsubscribe` in `src/gateway/rpc/handlers/debug-handlers.ts`

Those current APIs are session-level client broadcast filters inside gateway transport handling. They are not daemon detach operations.

### Disable/Stop

Disable/stop means changing whether a daemon, scheduler, adapter, or runtime workload continues doing work.

That is out of scope for this block.

### Disconnect

Disconnect means transport loss or transport closure, such as an IPC/socket boundary no longer being connected.

That is also distinct from explicit detach. Today the `connected` field on `GatewayDaemonAttachmentStatus` is only a projection of whether a daemon reference is attached in gateway lifecycle state; it is not an end-to-end transport-health signal.

### Teardown

Teardown means broader component or process shutdown.

Gateway shutdown, daemon shutdown, runtime teardown, or lifecycle disposal are larger concerns than detach and are not the next step here.

## In-Scope vs Out-of-Scope Semantics For This Block

In scope for the daemon detach/unsubscribe block:

- defining how gateway-owned daemon attachment can become intentionally detachable
- defining daemon-facing callback unsubscription ownership
- defining the lifecycle and state model of an explicit detach operation
- deciding what visibility should remain after detach

Out of scope for this block:

- daemon stop/kill/restart semantics
- scheduler lifecycle redesign
- startup/bootstrap redesign
- gateway/daemon IPC redesign
- session subscription redesign
- TUI detach UX
- event payload/schema changes
- provider execution or fallback changes

## Main Design Dimensions To Resolve Before Coding

### 1. Operation ownership

The codebase already suggests the right ownership split:

- detach command/state machine belongs to the gateway-owned attachment boundary
- unsubscribe mechanics belong to the daemon event-subscription contract
- transport reporting remains a projection consumer

The unresolved design point is the exact seam: whether daemon callback registration should return one unsubscriber per event hook, or whether the gateway should build a grouped binding object that owns all per-event unsubscribers.

### 2. Lifecycle and state transitions

The current detach-facing phases are too coarse for real behavior. Before coding, the operation must define at least:

- attached
- detach requested / unsubscribe in progress, if asynchronous handling is needed
- detached
- detach failed, if unsubscribe can fail

A key current constraint is that the existing event-emitter API is synchronous and add-only. If the future unsubscribe handles are synchronous and side-effect-free, the first slice can likely remain a synchronous state transition.

### 3. Idempotency expectations

Detach must define whether repeated detach calls:

- succeed as no-ops when already detached
- fail with a stable reason
- preserve prior detach metadata/state

The safest expectation is idempotent no-op behavior once already detached, because the current lifecycle surface already has a stable detached state.

### 4. Retry and failure semantics

If unsubscribe handle release is synchronous and local, the first slice can avoid retries entirely.

If detach later crosses transport or daemon-runtime boundaries, retry/failure semantics become much riskier. That is a strong reason not to start with a transport-coupled detach command.

### 5. Attachment/subscription visibility after detach

Questions that must stay explicit:

- after detach, should `connectedAt` be cleared or retained as historical metadata
- should detached status still expose the prior daemon as inaccessible internal history, or should the reference simply be nulled
- should status/reporting show detach capability independently from current attachment

The current lifecycle shape strongly favors clearing the live daemon reference and returning to the existing detached snapshot model, with no retained public history in the first slice.

### 6. Control-plane only vs runtime execution impact

This block must decide whether detach is only gateway control-plane state or whether it changes daemon execution.

The safest answer, grounded in current structure, is:

- detach is control-plane only for the first slice
- daemon execution, scheduler work, and runtime state remain unchanged
- only gateway event forwarding and gateway-owned attachment bookkeeping change

### 7. What kind of unsubscribe this is

The relevant unsubscribe question is not "per goal" or "per session". It is:

- per daemon event binding
- grouped across the set of callbacks that `registerDaemonEventForwarders(...)` installs
- owned by the gateway attachment boundary, but backed by daemon/runtime callback release handles

That should stay distinct from current per-session client broadcast subscriptions.

### 8. Audit/telemetry expectations

A later full detach command may merit audit visibility, but the first slice does not need a broad telemetry redesign.

The practical question is whether the first detach-capable slice should emit:

- a gateway internal log only
- a narrow audit event
- or no new telemetry at all

The safest first cut is minimal local observability only, unless an external control-plane entry point is added in the same session.

## Plausible Future Capability Slices

### Slice A: Add a public/system RPC detach command now

What it would involve:

- public or admin-facing control-plane entry point
- gateway attachment state mutation
- daemon callback release mechanics
- status and failure reporting behavior

Assessment:

- structural gain: medium
- semantic risk: high
- scope tightness: low
- coupling to transport/runtime behavior: high
- accidental redesign risk: high

Why it is not the safest first cut:

- current daemon event subscriptions are not releasable
- adding control-plane semantics before that seam exists would force design decisions about errors, retries, audit, and user-visible status too early

### Slice B: Introduce releasable daemon event-subscription bindings behind the existing gateway attachment boundary

What it would involve:

- evolve the daemon event-emitter contract so callback registration can be released
- make `registerDaemonEventForwarders(...)` return a grouped unsubscribe/release handle
- let `GatewayDaemonAttachment` own that binding as internal state
- optionally expose an internal detach-capable method only after the binding exists

Assessment:

- structural gain: high
- semantic risk: low
- scope tightness: high
- coupling to transport/runtime behavior: low
- accidental redesign risk: low

Why it is a strong candidate:

- it directly addresses the blocking structural gap shown by the current code
- it does not require public RPC, IPC, TUI, or event-schema changes
- it prepares real detach capability without redefining runtime behavior

### Slice C: Add a gateway-local detach method that only clears lifecycle state, leaving daemon callbacks registered

What it would involve:

- gateway lifecycle mutation without actual unsubscribe

Assessment:

- structural gain: low
- semantic risk: high
- scope tightness: superficially high, actually poor
- coupling to transport/runtime behavior: medium
- accidental redesign risk: medium

Why it should not be chosen:

- it would create false detach semantics
- daemon events would still flow through previously registered callbacks
- gateway status would diverge from real forwarding behavior

### Slice D: Design and implement a broader subscription-system overhaul spanning daemon and client subscriptions

Assessment:

- structural gain: uncertain
- semantic risk: high
- scope tightness: very low
- coupling to transport/runtime behavior: high
- accidental redesign risk: very high

Why it is not appropriate:

- it conflates daemon callback unsubscription with session/client subscription policy
- it would broaden the block beyond the current codebase evidence

## Chosen Safest First Future Capability Slice

The safest first future capability slice is:

- introduce releasable daemon event-subscription bindings behind the existing gateway attachment boundary

### What it would do

This first slice would:

- change the daemon event-emitter registration contract so daemon callback registration can produce release handles
- let `registerDaemonEventForwarders(...)` assemble those handles into one grouped binding cleanup function or binding object
- let `GatewayDaemonAttachment` own that grouped binding as part of its internal attachment state
- establish the structural precondition for a later real detach operation

### What it would not do

This first slice would not:

- add a public detach RPC
- change system status payload shapes
- change gateway/daemon IPC behavior
- stop, disable, kill, or restart daemon work
- alter scheduler or startup semantics
- change TUI behavior
- redesign event schemas
- conflate client/session unsubscribe with daemon unsubscribe

### Which layer would own it

Ownership should be:

- daemon/runtime layer owns callback registration release handles
- gateway integration layer owns grouped binding lifetime and future detach coordination
- transport/status layers remain projection-only consumers

### What semantics must remain unchanged around it

The following semantics must remain unchanged in the first cut:

- gateway startup behavior
- daemon startup behavior
- scheduler behavior
- provider execution/fallback behavior
- admin/runtime RPC behavior
- existing RPC/event payload shapes
- TUI behavior
- transport ownership boundaries from the closed RF-034 / RF-059 / RF-060 / RF-061 lines

### Why it is the right first cut

It is the right first cut because it solves the actual blocking structural problem shown by the live code:

- current detach-facing status already says the gateway is "awaiting daemon unsubscribe"
- but the daemon event contract cannot currently unsubscribe at all

Adding releasable bindings closes that gap without prematurely committing the system to a public detach command, a transport redesign, or runtime-execution semantics.

## What Is Explicitly Not Next

The next step is not:

- broad transport redesign
- daemon lifecycle redesign
- gateway runtime graph reopening
- subscription-system overhaul
- generic disconnect/stop/kill semantics
- TUI-driven detach UX work
- event schema redesign
- speculative future capability bundles that mix detach, disconnect, stop, and restart into one effort

It is also not:

- reopening RF-034, RF-059, RF-060, or RF-061
- resuming the paused Sessions 95-100 source-of-truth line
- resuming the paused Sessions 101-103 runtime-core singleton line

## Practical Small Roadmap

### Phase 1

Add releasable daemon callback bindings and grouped gateway-owned forwarding cleanup behind the existing attachment boundary.

### Phase 2

Add one gateway-owned internal detach operation that consumes the grouped binding cleanup and returns the lifecycle surface to detached state, while remaining control-plane only.

### Phase 3

Only after Phase 2 semantics are stable, consider whether a narrow external control-plane/reporting surface for explicit detach is justified.

## Recommended Session 105

Recommended Session 105:

- one bounded coding session implementing Phase 1 only: releasable daemon event-subscription bindings and grouped forwarding cleanup behind `GatewayDaemonAttachment`

That session should stay narrowly constrained to:

- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/integration/daemon-event-forwarding.ts`
- `src/gateway/integration/gateway-daemon-attachment.ts`
- targeted tests adjacent to those files

It should not add a public detach RPC or any broader detach UX/control-plane semantics yet.
