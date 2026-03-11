# Session 106: Daemon Detach Phase 2 Review

## Scope

Session 106 is a bounded review/decision session for Phase 2 of the daemon detach/unsubscribe capability block.

This session is documentation/design only. It does not change runtime behavior, startup behavior, scheduler behavior, gateway/daemon IPC, provider execution behavior, RPC/event payload shapes, or TUI behavior.

The goal is to choose the single safest next capability slice after Session 105 completed Phase 1.

## Reviewed Surfaces

Primary reviewed surfaces in the current codebase:

- `src/gateway/integration/gateway-daemon-attachment.ts`
- `src/gateway/integration/gateway-daemon-detach-operations.ts`
- `src/gateway/integration/gateway-daemon-lifecycle.ts`
- `src/gateway/integration/daemon-event-forwarding.ts`
- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/runtime/gateway-runtime-rpc-surface.ts`
- `src/gateway/gateway-server.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `test/gateway/integration/gateway-daemon-attachment.test.ts`
- `test/gateway/integration/gateway-daemon-detach-operations.test.ts`
- `docs/refactoring/session104-daemon-detach-capability-design.md`
- `docs/refactoring/session105-releasable-daemon-event-bindings.md`

## Post-Phase-1 Baseline

### What bindings now exist and who owns them

Phase 1 changed the structural baseline in one important way.

- `IDaemonEventEmitter` in `src/autonomy/daemon-event-emitter.ts` now returns a `DaemonEventSubscription` handle from each `on...` registration method.
- `DaemonEventEmitterMixin` still owns the callback registry, but registered callbacks can now be released idempotently.
- `registerDaemonEventForwarders(...)` in `src/gateway/integration/daemon-event-forwarding.ts` now returns one grouped `DaemonEventForwardingBinding`.
- `GatewayDaemonAttachment` stores that grouped binding in `forwardingBinding`.

So the live ownership line is now:

- daemon/runtime owns the callback registry and individual subscription removal
- gateway forwarding owns the grouping of those subscriptions
- `GatewayDaemonAttachment` owns the lifetime of the grouped forwarding binding for the current attachment

### What can now be released structurally

The gateway now has a real local seam for stopping daemon-to-gateway event forwarding:

- `GatewayDaemonAttachment.forwardingBinding.release()`

That grouped release would stop the event forwarders installed by `registerDaemonEventForwarders(...)` without requiring daemon lifecycle changes, transport changes, or payload changes.

This is the key structural result of Phase 1.

### What still cannot be requested or invoked

The current code still does not provide any intentional detach or unsubscribe operation:

- `GatewayDaemonAttachment` has `connect(...)`, but no `detach()` or `unsubscribe()` method
- `GatewayDaemonDetachSurface` still exposes read-only status helpers only
- no RPC or control-plane handler accepts a daemon detach request
- no public gateway surface exposes a detach command
- no caller invokes `forwardingBinding.release()`

So detach is more possible structurally than it was in Session 104, but it is still not an operation the system can request.

### What detach-facing status is currently only declarative/projection

`src/gateway/integration/gateway-daemon-detach-operations.ts` still derives detach-facing status entirely from lifecycle attachment state:

- unattached -> `phase: 'idle'`, `attached: false`
- attached -> `phase: 'attached-awaiting-daemon-unsubscribe'`, `attached: true`

The current `GatewayDaemonDetachStatus` remains:

- `detachSupported: false`
- `unsubscribeSupported: false`

That status is still descriptive only. It reports that attached state exists and that a meaningful detach would need unsubscription, but it does not indicate an invokable operation.

### What lifecycle state still remains coupled to "attached"

`GatewayDaemonLifecycle` still has only:

- `daemon: IDaemonEventEmitter | null`
- `connectedAt: number | null`

and derives:

- `phase: 'detached' | 'attached'`
- `connected: boolean`

That means the following things are still coupled together:

- attached daemon reference presence
- public `connected` reporting
- public attachment phase
- derived detach-facing phase

Releasing the forwarding binding alone would not currently change any of those projections. The system would still report attached/connected until lifecycle state changes, because all status surfaces are still driven by `GatewayDaemonLifecycle`.

## What Phase 1 Did Not Yet Settle

Phase 1 intentionally did not decide:

- whether a grouped forwarding release alone should count as detach
- whether internal detach should clear the attached daemon reference
- whether repeated detach should be a no-op
- whether detach-facing status should ever report support before a callable operation exists
- whether any public/control-plane entry point should exist at all

Those questions now matter more than raw subscription mechanics.

## Plausible Phase 2 Slices

Only slices that fit the current structure are considered here.

### Slice A: Internal-only `GatewayDaemonAttachment.detach()` that only releases grouped forwarders

This slice would add an internal method on `GatewayDaemonAttachment` that:

- checks for a current `forwardingBinding`
- calls `forwardingBinding.release()`
- clears the binding field or otherwise makes repeated release idempotent

What it would not do:

- change `GatewayDaemonLifecycle`
- clear the attached daemon reference
- change `GatewayDaemonDetachStatus`
- expose any public RPC/control-plane command

This is the narrowest possible executable use of the new Phase 1 seam.

### Slice B: Internal detach operation plus attachment-state transition

This slice would add an internal detach operation that:

- releases grouped forwarders
- clears the current attached daemon reference and attachment snapshot state
- returns lifecycle/status to the existing detached projection

This would likely require adding an explicit detach/reset capability to `GatewayDaemonLifecycle`, not just a method on `GatewayDaemonAttachment`.

### Slice C: Internal unsubscribe-only seam without detach semantics

This slice would avoid the word "detach" entirely and add an internal helper dedicated only to releasing forwarding subscriptions, such as:

- `releaseForwardingBinding()`
- or a detach-operations helper focused on unsubscription state

It would intentionally preserve current attachment lifecycle state and status semantics.

### Slice D: Minimal public/control-plane detach entry point

This slice would expose some external operation, such as a system/admin/internal RPC command, that triggers the internal detach path.

Even in a minimal version, it would need to decide:

- whether the command is supported when attached
- how success/failure is reported
- what `system.status` and related status surfaces should say before and after invocation
- what compatibility guarantees exist for current public gateway surfaces

## Evaluation Of Plausible Slices

### Slice A: Internal-only `detach()` that only releases grouped forwarders

Structural gain:

- proves the Phase 1 grouped release seam is usable from the intended owner
- keeps ownership inside `GatewayDaemonAttachment`
- does not force lifecycle redesign immediately

Semantic risk:

- high relative to its structural size, because the method name "detach" would not match public state afterward
- after invocation, the gateway would stop forwarding daemon events but still report attached/connected
- creates a misleading partial detach concept unless carefully hidden

Scope tightness:

- very tight in code size
- not tight in semantics, because it introduces observable internal split-brain between forwarding state and lifecycle state

Coupling to status/lifecycle semantics:

- strong hidden coupling
- it avoids changing status code, but only by leaving state inaccurate relative to behavior

Risk of forcing transport/RPC/TUI redesign:

- low immediately
- but it leaves an unstable semantic base for any future public reporting

Staged rollout fit:

- mixed
- structurally incremental, but semantically awkward

### Slice B: Internal detach operation plus attachment-state transition

Structural gain:

- creates the first coherent end-to-end internal detach capability
- keeps detach ownership where the current boundary already lives
- reuses the existing detached lifecycle/status projection instead of inventing new public shapes

Semantic risk:

- moderate
- this is the first slice that actually changes attachment semantics, so idempotency and reference-clearing rules must be explicit
- however, the semantics are still local and synchronous if bounded to grouped release plus lifecycle reset

Scope tightness:

- still bounded
- touches only `GatewayDaemonAttachment`, `GatewayDaemonLifecycle`, nearby detach-operation derivation, and tests

Coupling to status/lifecycle semantics:

- explicit but manageable
- it requires defining what internal detach means, but it can preserve current public status shapes by returning to the existing detached projection

Risk of forcing transport/RPC/TUI redesign:

- low if kept internal-only
- no RPC command, payload, or TUI work is needed

Staged rollout fit:

- strong
- it completes the first internally coherent detach slice without broadening into external control-plane design

### Slice C: Internal unsubscribe-only seam without detach semantics

Structural gain:

- makes the grouped release seam callable without committing to detach wording
- can be framed honestly as forwarding cleanup only

Semantic risk:

- lower than Slice A if named as unsubscribe/forwarding release
- but still leaves lifecycle/status reporting attached, so it intentionally creates a state where forwarding is absent while attachment remains true

Scope tightness:

- very tight

Coupling to status/lifecycle semantics:

- weaker than Slice A only because it avoids overclaiming
- still not a full capability slice for detach, because lifecycle semantics remain unresolved

Risk of forcing transport/RPC/TUI redesign:

- very low

Staged rollout fit:

- acceptable as a micro-step, but weaker than necessary now that the grouped release seam already exists
- risks spending a session on a helper that still does not settle the actual Phase 2 semantic boundary

### Slice D: Minimal public/control-plane detach entry point

Structural gain:

- low relative to semantic cost unless an internal detach model already exists
- the current runtime RPC surface and `system.status` consumers would become part of the active design surface immediately

Semantic risk:

- high
- a public command would force decisions about support flags, idempotency, error reporting, status visibility, and compatibility behavior right away

Scope tightness:

- poor
- even "minimal" public exposure would spill into handler design, status/reporting expectations, and likely test coverage beyond the attachment seam

Coupling to status/lifecycle semantics:

- very high
- because public invocation and public reporting cannot safely disagree

Risk of forcing transport/RPC/TUI redesign:

- high
- this is the slice most likely to pull in RPC schema, capability reporting, TUI expectations, or compatibility surface questions

Staged rollout fit:

- poor
- it skips the internal semantic stabilization step the current codebase still needs

## Safest Phase 2 Slice

The single safest next capability slice for Phase 2 is:

### Internal detach operation plus attachment-state transition

More concretely:

- add one internal-only detach operation owned by `GatewayDaemonAttachment`
- make that operation release the grouped forwarding binding owned by the current attachment
- make that same operation transition `GatewayDaemonLifecycle` back to its detached state
- preserve the current public status shapes by reusing the already-existing detached projection rather than adding new detach phases or new payload fields

This is effectively Slice B.

## Why This Slice Is Safer Than The Alternatives

It is safer than Slice A because a method named detach should not leave the system publicly attached forever.

It is safer than Slice C because Phase 1 already proved the unsubscribe primitive. Another session that only wraps grouped release without settling attachment-state semantics would likely create a weaker intermediate abstraction than the code now needs.

It is safer than Slice D because external entry points would immediately drag the runtime RPC surface, system status semantics, and compatibility expectations into scope before the internal detach model is stable.

## Exact Definition Of The Chosen Slice

### What it would do

- release the grouped daemon-event forwarding binding currently stored by `GatewayDaemonAttachment`
- clear the attachment-owned grouped binding reference
- clear the attached daemon reference/lifecycle snapshot through a narrow lifecycle detach/reset capability
- cause `getStatus()`, `getDetachStatus()`, and `getOperationState()` to project the existing detached/idle state after internal detach
- define repeated internal detach as idempotent no-op behavior when already detached

### What it would not do

- expose a public RPC/admin/internal-runtime detach command
- change `GatewayDaemonDetachStatus` field names or payload shape
- change `detachSupported` / `unsubscribeSupported` reporting in the same slice unless a callable public surface is also being introduced, which it should not be
- add new detach-progress or detach-failure public phases
- stop, restart, disconnect, or otherwise control daemon execution
- change scheduler behavior
- change startup/bootstrap behavior
- change gateway/daemon IPC behavior
- change provider execution/fallback behavior
- change event or RPC payload schemas
- change TUI behavior

### Who owns it

Ownership should stay entirely inside the current gateway-owned attachment boundary:

- primary owner: `GatewayDaemonAttachment`
- supporting lifecycle owner: `GatewayDaemonLifecycle`
- detach-facing status derivation remains in `gateway-daemon-detach-operations.ts`

### Internal-only or externally exposed

This slice should be internal-only.

No public/control-plane exposure should be added in the same session.

### Whether attached-daemon reference/state changes are part of the slice

Yes.

That is the core reason this slice is the right Phase 2 boundary. Internal detach should include both:

- forwarding unsubscription
- attachment-state transition

Without the attachment-state transition, the code gains only partial forwarding cleanup and leaves the lifecycle/status model inconsistent with the operation name.

### What detach/unsubscribe/status semantics must remain unchanged around it

The following semantics should remain unchanged in the chosen Phase 2 slice:

- `GatewayDaemonDetachStatus` remains a projection helper, not a new public command contract
- `detachSupported` and `unsubscribeSupported` remain unchanged unless and until a public command surface is actually added
- no new transport-health meaning is assigned to `connected`
- detach remains a gateway-owned attachment operation, not a daemon stop/disconnect command
- existing RPC/event payload shapes remain unchanged
- session/client subscription APIs remain unrelated and untouched

## Required Semantic Decisions Before Coding

The chosen slice is narrow, but it still requires a few explicit decisions before implementation.

### 1. Internal detach is synchronous and local

The detach operation should be defined as:

- synchronous
- local to the gateway-owned attachment boundary
- complete once grouped forwarders are released and lifecycle state is cleared

It should not wait on daemon-side acknowledgements or IPC.

### 2. Repeated internal detach is a no-op

If no daemon is attached and no grouped binding exists, internal detach should succeed as a no-op.

That matches the current stable detached lifecycle model and avoids introducing unnecessary failure semantics.

### 3. Lifecycle reset should clear live attachment identity, not retain historical attachment state

For this slice, the safest model is:

- clear the live daemon reference
- clear `connectedAt`
- return to the same detached snapshot already used before any attach

Retaining detached-but-last-attached metadata would broaden status semantics for little gain.

### 4. Public support flags should not be reinterpreted yet

Even after internal detach exists, the public detach-facing flags should not be upgraded casually. A public support flag should mean there is an actual public capability surface, not just an internal method.

That interpretation avoids status drift and preserves the staged rollout.

## Tempting Directions That Must Still Be Avoided

The following are explicitly not next:

- broad transport redesign
- daemon lifecycle stop/restart/disconnect work
- TUI detach UX
- public RPC/event schema redesign
- session/client subscription cleanup
- speculative full detach bundles that mix detach with transport, lifecycle, or daemon process control
- gateway runtime graph reopening
- reopening RF-034, RF-059, RF-060, or RF-061
- resuming the paused Sessions 95-100 or 101-103 lines

Additional tempting but unsafe directions to avoid in this block:

- changing `connected` to mean transport health
- exposing partial detach/public support flags before there is a stable external entry point
- introducing unsubscribe semantics for non-daemon session subscriptions under the same task
- bundling detach with daemon reattach/reconnect policy

## Recommended Session 107

Recommend exactly one next session:

### Session 107: bounded coding session for internal gateway-owned detach with lifecycle reset

That session should implement only the chosen Phase 2 slice:

- internal-only detach on `GatewayDaemonAttachment`
- narrow lifecycle detach/reset support in `GatewayDaemonLifecycle`
- grouped forwarding release invocation
- preservation of current public status shapes and unsupported detach flags
- targeted tests proving idempotent internal detach and detached-state projection

It should not add RPC handlers, TUI behavior, transport redesign, or daemon lifecycle controls.

## Practical Roadmap For The Rest Of This Capability Block

### Phase 2

- implement internal gateway-owned detach with grouped forwarding release plus lifecycle reset

### Phase 3

- review whether a minimal external/control-plane detach entry point is justified now that internal detach semantics are stable

### Phase 4

- if and only if justified, add one narrow public/admin detach surface with explicit compatibility and status semantics

### Later only if still needed

- review richer reporting, audit visibility, or reattach policy separately
- keep daemon process lifecycle control, transport disconnect/reconnect behavior, and TUI detach UX out as separate concerns rather than folding them into detach

## Validation For This Session

This session intentionally made no runtime code changes.

Validation performed:

- reviewed the live attachment, lifecycle, detach-status, forwarding, and daemon event-emitter sources listed above
- reviewed the direct status/reporting consumers in `GatewayRuntimeRpcSurface`, `GatewayServer`, and `system.status`
- reviewed existing tests covering the current attachment and detach-status baseline
- confirmed the working tree changes for this session are documentation-only

No runtime tests were run because this session did not change runtime code.
