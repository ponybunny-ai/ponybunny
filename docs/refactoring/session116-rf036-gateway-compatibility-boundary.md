# Session 116: RF-036 Gateway Compatibility Boundary

## Targeted RF-036 Cluster

Session 116 completed the first major RF-036 coding cluster selected in Session 115:

- separate legacy gateway-facing `task.narration` / `task.result` handling from the authoritative live gateway/TUI event protocol
- make that separation explicit in code structure and gateway typing
- preserve runtime, transport, and TUI behavior while narrowing the public meaning of the current gateway event surface

This session stayed tightly bounded to the gateway/TUI compatibility boundary and did not broaden into internal runtime protocol renaming or transport redesign.

## Compatibility-Only Boundary Introduced

The session introduced one explicit compatibility-only boundary for legacy gateway-facing `task.*` events:

- `src/gateway/types.ts` now treats the authoritative live gateway protocol and compatibility-only `task.*` events as separate unions
- `src/gateway/compatibility.ts` now owns the runtime helper/type exports for compatibility-only event classification
- `src/cli/tui/task-event-compatibility.ts` now contains the legacy TUI handling path for `task.narration` / `task.result`
- `src/cli/tui/app.tsx` now routes `task.*` events through an explicit compatibility branch before the main live event switch

This makes the code read as:

- live gateway/TUI protocol: `goal.*`, `workitem.*`, `run.*`, `verification.*`, plus the existing other live gateway families
- compatibility-only task residue: `task.narration`, `task.result`

## Gateway Typing Changes

Gateway typing was tightened in the safest local way supported by the current code:

- `GatewayEventType` in `src/gateway/types.ts` now represents the authoritative live gateway event protocol only
- `GatewayCompatibilityEventType` now explicitly represents legacy `task.narration` / `task.result`
- `AnyGatewayEventType` exists only as the mixed compatibility union when older compatibility handling is needed
- `GatewayEvent<T>` remains the live gateway event envelope
- `GatewayCompatibilityEvent<T>` now exists as the compatibility-only envelope type
- `Subscription.eventTypes` now reflects the live protocol only instead of implying `task.narration` / `task.result` are normal current subscription targets
- `src/gateway/public.ts` stays live-only, while `src/gateway/compatibility.ts` now owns the compatibility helper/type exports

This is the main protocol-boundary cleanup of the session: legacy gateway `task.*` events are no longer presented as first-class live transport events on the public live surface.

## TUI Handling Changes

TUI behavior was preserved while the boundary became explicit:

- `src/cli/tui/app.tsx` no longer keeps `task.narration` / `task.result` inside the main live event switch
- the TUI now first checks whether an incoming event is a compatibility-only gateway event
- if so, handling is delegated to `src/cli/tui/task-event-compatibility.ts`
- the helper preserves the old narration/result fallback behavior for goal-scoped and latest-processing-message updates

This keeps the TUI able to safely handle compatibility events if they appear, while making it clear those events are not the normal live protocol path.

## Semantics Intentionally Preserved

The session intentionally preserved all current behavior called out in the prompt:

- `SchedulerCore` still publishes `task.ready`
- `LocalExecutionWorker` still subscribes to `task.ready`
- `execution.*` ownership and meaning are unchanged
- `SchedulerBridge` and `IPCBridge` still emit the same live gateway event mappings
- `BroadcastManager` still routes the same live gateway event families and still does not publish `task.narration` / `task.result`
- TUI user-visible behavior remains unchanged for live events and for any legacy compatibility `task.*` events that might still appear
- live gateway RPC/event/status payload shapes remain unchanged

## Why `task.ready` and Deeper Internal Protocol Work Stayed Out of Scope

Session 115 already showed that the only currently live authoritative runtime `task.*` path is `task.ready` between scheduler and `LocalExecutionWorker`.

That seam:

- is runtime-internal, not the gateway/TUI transport protocol
- already has a different meaning from the legacy gateway-facing `task.narration` / `task.result` labels
- is coupled to evented dispatch, replay/checkpointing, and worker execution ownership

Renaming or reclassifying that seam would have pushed this session into a broader runtime protocol change. That was intentionally excluded so Session 116 could finish one high-value, low-risk protocol-boundary cleanup in one pass.

## Likely Remaining RF-036 Follow-Up for the Next Review

The next RF-036 session should be a review / re-ranking pass rather than another small cleanup:

- confirm this gateway/TUI compatibility-boundary cluster fully removed the live-protocol ambiguity around `task.narration` / `task.result`
- reassess whether the remaining justified RF-036 target is the runtime-internal `task.ready` seam or some other protocol boundary
- decide whether any further work should stay boundary-local or wait because the remaining candidates are more entangled with runtime/event-store semantics
