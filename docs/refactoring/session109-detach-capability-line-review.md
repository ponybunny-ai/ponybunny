# Session 109: Detach Capability Line Review

## Scope

Session 109 is a bounded review / re-ranking session for the daemon detach/unsubscribe capability block after completion of Sessions 104-108.

This session is documentation only. It does not change runtime behavior, startup/bootstrap behavior, scheduler semantics, gateway/daemon IPC behavior, provider execution behavior, RPC/event payload shapes, or TUI behavior.

The purpose of this session is to decide whether the current detach capability line should continue immediately with one more tightly bounded slice, or pause here and yield priority to a different major block.

## Reviewed Codebase Surfaces

Primary current-code surfaces reviewed for this decision:

- `src/gateway/integration/gateway-daemon-attachment.ts`
- `src/gateway/integration/gateway-daemon-detach-operations.ts`
- `src/gateway/integration/gateway-daemon-lifecycle.ts`
- `src/gateway/integration/daemon-event-forwarding.ts`
- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/runtime/gateway-runtime-rpc-surface.ts`
- `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `src/gateway/gateway-server.ts`
- `test/gateway/integration/gateway-daemon-attachment.test.ts`
- `test/gateway/integration/gateway-daemon-detach-operations.test.ts`
- `test/gateway/rpc/internal-runtime-handlers.test.ts`
- `docs/refactoring/session104-daemon-detach-capability-design.md`
- `docs/refactoring/session105-releasable-daemon-event-bindings.md`
- `docs/refactoring/session106-daemon-detach-phase2-review.md`
- `docs/refactoring/session107-internal-detach-with-lifecycle-reset.md`
- `docs/refactoring/session108-detach-control-plane-entrypoint.md`

## What Phases 1-3 Actually Achieved

The current codebase now has a complete internal/admin detach path with support reporting aligned to that reachable behavior.

### Phase 1: releasable emitter bindings

Session 105 changed `IDaemonEventEmitter` in `src/autonomy/daemon-event-emitter.ts` so daemon callback registration returns releasable `DaemonEventSubscription` handles instead of being add-only.

`registerDaemonEventForwarders(...)` in `src/gateway/integration/daemon-event-forwarding.ts` now returns one grouped `DaemonEventForwardingBinding`, and `GatewayDaemonAttachment` retains that grouped binding as attachment-owned state.

This was the critical structural precondition for any honest detach work.

### Phase 2: internal detach with lifecycle reset

Session 107 added `GatewayDaemonAttachment.detach()` in `src/gateway/integration/gateway-daemon-attachment.ts`.

That detach seam now:

- releases the grouped forwarding binding if present
- clears the stored binding
- resets `GatewayDaemonLifecycle` to the existing detached snapshot through `resetToDetached()`
- behaves idempotently on repeated calls

This created the first coherent internal detach operation without changing public payloads or transport behavior.

### Phase 3: control-plane reachability

Session 108 wired `internal.runtime.daemon.detach` in `src/gateway/rpc/handlers/internal-runtime-handlers.ts` through `GatewayRuntimeRpcSurface` in `src/gateway/runtime/gateway-runtime-rpc-surface.ts`.

That means detach is now actually invokable through one existing admin-only internal runtime RPC surface. The request path still terminates in the same owner seam: `GatewayDaemonAttachment.detach()`.

### Support reporting is now aligned

`getGatewayDaemonDetachStatus(...)` in `src/gateway/integration/gateway-daemon-detach-operations.ts` now reports:

- `detachSupported: true`
- `unsubscribeSupported: false`

That is consistent with the current codebase:

- detach is reachable through `internal.runtime.daemon.detach`
- unsubscribe is still not a separate supported capability or protocol

### Boundaries preserved

The block still intentionally preserves the boundaries selected in Sessions 104-108:

- no unsubscribe protocol was added
- no TUI/operator detach rollout was added
- no gateway/daemon transport redesign was added
- no scheduler/startup/provider execution semantics changed
- no RPC/event payload shape redesign was introduced

## Current Structural State After Phase 3

The live detach line is now structurally coherent at its intended scope:

- daemon-side callback release exists
- gateway-owned grouped forwarding release exists
- gateway-owned lifecycle reset exists
- one internal/admin control-plane entrypoint exists
- detach reporting now matches reachable behavior

There is no obvious internal inconsistency left inside the currently chosen ownership line. The remaining plausible directions all broaden beyond that line into rollout, protocol, or UI questions.

## Plausible Remaining Directions Still Supported By The Current Codebase

Only directions grounded in the current tree are considered here.

### 1. Broader/public detach rollout

The current code already has one admin/internal detach RPC. A next step could expose detach on a broader public or system-facing surface.

Codebase grounding:

- `internal.runtime.daemon.detach` already exists
- `system-handlers.ts` is the existing broader admin/status surface
- `GatewayServer` and `GatewayRuntimeRpcSurface` already assemble outward status/reporting

### 2. Unsubscribe capability design

The current codebase now has local callback release mechanics, but it still does not expose a distinct unsubscribe capability beyond grouped forwarding release hidden behind detach.

Codebase grounding:

- `DaemonEventSubscription.release()` exists
- `DaemonEventForwardingBinding.release()` exists
- `unsubscribeSupported` still reports `false`
- there is no separate unsubscribe RPC or operation surface

### 3. Detach status/reporting cleanup

The current reporting could be tightened cosmetically or semantically, for example around detach-facing wording or what is shown when attached vs detached.

Codebase grounding:

- `GatewayDaemonDetachPhase` still uses `'idle' | 'attached-awaiting-daemon-unsubscribe'`
- `GatewayRuntimeRpcSurface.getGatewayStatusSnapshot()` projects `daemonDetach`
- `system.status` already consumes gateway status snapshots

### 4. Daemon-side unsubscribe acknowledgement / protocol work

A future step could try to make unsubscribe an explicit daemon-facing operation or acknowledgement rather than only local callback release.

Codebase grounding:

- current detach is entirely gateway-owned and synchronous
- there is no daemon-facing IPC command or acknowledgement path for unsubscribe
- current handler and transport code do not carry such a protocol

### 5. TUI/operator detach UX

A future step could expose detach to operators through CLI/TUI-facing clients.

Codebase grounding:

- TUI and client request surfaces already exist elsewhere in the tree
- no TUI/client call currently targets `internal.runtime.daemon.detach`

### 6. Narrower internal detach-facing cleanup

A final small internal cleanup could try to reduce wording ambiguity without expanding behavior.

Codebase grounding:

- the main candidate is status/reporting wording around `attached-awaiting-daemon-unsubscribe`
- core detach ownership itself already looks settled in `GatewayDaemonAttachment`

## Evaluation Of Each Plausible Direction

### Broader/public detach rollout

Structural gain:

- moderate at best
- would make the capability more visible, but it would not strengthen the internal ownership line much further because that line is already complete

Semantic risk:

- moderate to high
- broadening outward changes who can invoke detach and starts defining public/system semantics rather than just internal control-plane semantics

Scope tightness:

- weaker than Sessions 105-108
- even a minimal rollout would force decisions about method placement, permissions, operator expectations, and error/reporting semantics

Coupling to transport/runtime behavior:

- moderate
- rollout touches outward RPC/control surfaces even if the detach implementation stays local

Schema/UI/protocol redesign pressure:

- medium
- not necessarily an immediate payload redesign, but it starts a public contract discussion that the current staged rollout intentionally avoided

Fit with staged rollout discipline:

- weaker now
- the staged line succeeded because it stayed internal until behavior was structurally real; the next outward step is no longer just structural

### Unsubscribe capability design

Structural gain:

- low to moderate
- the current code already has the practical local unsubscribe primitive needed by the gateway through `release()`

Semantic risk:

- high
- making unsubscribe a first-class capability forces a new distinction between detach and unsubscribe that the current reachable behavior does not need

Scope tightness:

- weak
- this is a design line, not a small cleanup

Coupling to transport/runtime behavior:

- high
- explicit unsubscribe semantics start pulling on daemon/runtime contract meaning rather than just gateway-owned attachment cleanup

Schema/UI/protocol redesign pressure:

- high
- likely to force new capability/status semantics and possibly new protocol or acknowledgement choices

Fit with staged rollout discipline:

- poor
- this would reopen the broader unsubscribe question instead of harvesting a clear next bounded slice

### Detach status/reporting cleanup

Structural gain:

- low
- status/reporting is already aligned with actual reachable behavior: detach true, unsubscribe false

Semantic risk:

- low to moderate
- small wording cleanups are easy to underestimate and can blur the intentional distinction between reachable detach and unsupported unsubscribe

Scope tightness:

- tight in code size
- weak in value

Coupling to transport/runtime behavior:

- low

Schema/UI/protocol redesign pressure:

- low to moderate
- any reporting cleanup risks unnecessary churn on already-stable outward projections

Fit with staged rollout discipline:

- weak
- this would mostly polish a line that is already structurally complete enough to pause

### Daemon-side unsubscribe acknowledgement / protocol work

Structural gain:

- potentially high in a different line of work
- but not necessary for the currently shipped internal detach capability

Semantic risk:

- very high
- it would change what detach/unsubscribe mean across gateway/daemon boundaries

Scope tightness:

- poor
- this is no longer a narrow follow-up slice

Coupling to transport/runtime behavior:

- very high
- directly tied to IPC/transport/runtime behavior that this block explicitly avoided changing

Schema/UI/protocol redesign pressure:

- high

Fit with staged rollout discipline:

- poor
- this would break the bounded discipline that made Sessions 105-108 successful

### TUI/operator detach UX

Structural gain:

- low
- this is rollout, not structural completion

Semantic risk:

- moderate
- operator-facing affordances imply broader support guarantees and workflow expectations

Scope tightness:

- weak
- UI/client work tends to drag in permissions, messaging, and support/reporting questions

Coupling to transport/runtime behavior:

- moderate
- depends on choosing which outward command surface is authoritative

Schema/UI/protocol redesign pressure:

- high on the UI side even if transport payloads stay stable

Fit with staged rollout discipline:

- poor
- there is no evidence that UI rollout is the next highest-value need

### Narrower internal detach-facing cleanup

Structural gain:

- very low
- the live ownership line already looks settled

Semantic risk:

- low

Scope tightness:

- tight

Coupling to transport/runtime behavior:

- low

Schema/UI/protocol redesign pressure:

- low

Fit with staged rollout discipline:

- acceptable but low-yield
- this is exactly the kind of momentum-driven extra slice that should be resisted when returns are diminishing

## Conclusion

This block is now at a good pause point.

After Phases 1-3, the detach capability line has reached a structurally honest completion point for its intended bounded scope:

- detach is real rather than declarative only
- detach is owned by the explicit gateway attachment boundary
- detach is reachable through one existing internal/admin control-plane surface
- support reporting matches actual reachable behavior
- unsubscribe remains intentionally unsupported rather than half-designed

There is not one more clearly high-value, tightly bounded next slice inside this block that improves structure without forcing broader public rollout, unsubscribe semantics, protocol work, or UI work.

The remaining detach-adjacent directions are real, but they are no longer the same kind of narrow structural cleanup that justified Sessions 105-108. Pushing further now would mostly spend scope budget on rollout semantics rather than on another clear ownership repair.

## Practical Re-Ranking Against Broader Remaining Candidates

Because this block should pause, the next session should be chosen against broader remaining candidates already visible in the current project state.

### 1. RF-062 gateway runtime observation/wiring follow-up

This is the strongest current candidate.

Why:

- `docs/refactoring/ponybunny_refactor_master_task_list.md` already marks RF-062 as the next planned GatewayServer-adjacent wiring follow-up
- `src/gateway/gateway-server.ts` still directly owns `GatewayToolProviderRuntime` construction and then publishes `toolRegistry`, allowlist, and enforcer into adjacent runtime/control surfaces
- this looks like real remaining service-wiring pressure rather than a paused line or a closed transport/bootstrap concern

### 2. RF-030 conversation materialization decoupling

Still important, but not the best immediate pick.

Why:

- it is explicitly marked as an important semantic boundary
- but it is likely broader and more behavior-adjacent than RF-062, which makes it a worse immediate choice if the goal is another bounded structural session

### 3. RF-036 event protocol cleanup

Not the right next move.

Why:

- it is explicitly low priority in the task list
- it trends toward protocol normalization rather than a clearly pressing ownership seam

## What Should Not Be Done Next

- Do not broaden detach to a public/system/client-facing command just because the internal admin path now exists.
- Do not start daemon-side unsubscribe acknowledgement or IPC protocol work under this block.
- Do not turn `unsubscribeSupported: false` into a design itch that forces new outward semantics without a stronger need.
- Do not add TUI/operator detach UX before there is a clear priority case for broader rollout.
- Do not spend a session polishing detach phase wording or status cosmetics unless that cleanup is bundled into a more important block.
- Do not reopen RF-034, RF-059, RF-060, RF-061, or the paused Sessions 95-100 / 101-103 lines through detach-adjacent wording.

## Recommended Session 110

Pause the detach capability block and start RF-062: a bounded review/coding session on the next `GatewayServer` runtime observation/service-wiring cluster, with the first target centered on the still-mixed tool/provider runtime ownership currently composed directly in `src/gateway/gateway-server.ts`.

That is a better next session than extending the detach line because it still addresses a live structural concentration in the current codebase, while detach follow-ups now mostly imply rollout or protocol decisions rather than another clearly high-value bounded ownership repair.

## Validation

Validation for this session was targeted and documentation-oriented:

- reviewed the current implementation in the detach ownership path and control-plane path
- reviewed the current tests that define the reachable detach behavior and support reporting
- confirmed the only intended file changes for Session 109 are this review document and the master task list update

No runtime code changes were made in this session.
