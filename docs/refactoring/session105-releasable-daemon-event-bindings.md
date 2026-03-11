# Session 105: Releasable Daemon Event Bindings

## Scope

Session 105 completes Phase 1 of the daemon detach/unsubscribe capability block selected in Session 104.

The goal of this session was narrowly structural:

- make daemon callback registrations releasable
- make gateway daemon-event forwarding return one grouped cleanup binding
- make `GatewayDaemonAttachment` own that grouped binding lifetime internally

This session does not add a public detach command, does not change gateway/daemon IPC, and does not change daemon lifecycle or runtime execution semantics.

## Releasable Binding Mechanism Introduced

`src/autonomy/daemon-event-emitter.ts` now exports a narrow `DaemonEventSubscription` handle:

- `release(): void`

Each `IDaemonEventEmitter.on...` registration method now returns one such handle instead of `void`.

`DaemonEventEmitterMixin` now:

- registers callbacks through one shared helper
- removes callbacks safely when `release()` is called
- makes release idempotent
- emits through a stable callback snapshot so listener removal during an active emit cycle does not corrupt ordering or skip later listeners

This keeps the change tightly bounded to the daemon-owned callback registry seam while creating the first real unsubscribe primitive needed for future detach work.

## Emitter Contract Change

The emitter contract change is minimal but real:

- before: add-only callback registration with no release path
- after: add callback and receive one releasable subscription handle

What did not change:

- event names
- callback argument shapes
- event payload contents
- registration ordering
- synchronous callback invocation model
- daemon/runtime ownership of the event registry

The contract is still a daemon-owned in-process callback surface. It is simply no longer add-only.

## Grouped Gateway Forwarding Cleanup

`src/gateway/integration/daemon-event-forwarding.ts` now returns a grouped `DaemonEventForwardingBinding` with:

- `release(): void`

`registerDaemonEventForwarders(eventBus, daemon)` now:

- registers the existing set of gateway-owned daemon forwarders
- collects each daemon-side subscription handle
- returns one grouped binding that releases all installed forwarders together

This means the gateway forwarding helper is no longer an add-only side effect. The existing forwarding translations, event names, and payload shapes remain unchanged.

## GatewayDaemonAttachment Binding Ownership

`src/gateway/integration/gateway-daemon-attachment.ts` now stores the grouped forwarding binding as internal state for the current attachment.

Current behavior remains the same:

- first attach installs daemon event forwarders
- second attach still warns and preserves the first attachment
- status and detach-facing status shapes remain unchanged

The important structural difference is that the attachment boundary now owns the installed forwarding binding rather than discarding it after registration. That gives future internal detach work a real local release seam without adding fake detach semantics in this session.

## Semantics Intentionally Preserved

This session intentionally preserved:

- current attach behavior
- current `GatewayDaemonAttachmentStatus` shape
- current `GatewayDaemonDetachStatus` shape and `detachSupported` / `unsubscribeSupported` reporting
- current gateway status snapshot consumers
- current RPC/event payload shapes
- current daemon runtime behavior
- current scheduler/startup behavior
- current TUI behavior
- current gateway/daemon IPC behavior

No public/system/admin detach RPC was added.
No daemon stop/restart/disconnect semantics were introduced.
No session/client unsubscribe APIs were touched.

## Validation

Targeted validation for the affected path:

- `test/autonomy/daemon-event-emitter.test.ts`
  - validates registration returns releasable handles
  - validates release is idempotent
  - validates emit-cycle ordering is preserved when a callback releases itself
- `test/gateway/integration/daemon-event-forwarding.test.ts`
  - validates `registerDaemonEventForwarders(...)` returns one grouped binding
  - validates grouped release stops all installed forwarders
- `test/gateway/integration/gateway-daemon-attachment.test.ts`
  - validates forwarding still reaches the gateway event bus
  - validates attach/status/detach-status semantics remain unchanged
  - validates the attachment boundary retains the grouped forwarding binding internally
- `test/gateway/integration/gateway-daemon-detach-operations.test.ts`
  - validates detach-facing status derivation remains unchanged

## Phase 2 Still Out Of Scope

The following remains for Phase 2 or later sessions:

- deciding whether to add an internal detach method on `GatewayDaemonAttachment`
- deciding idempotent detach semantics once release is actually invoked by the gateway
- deciding whether lifecycle state should clear the attached daemon reference during internal detach
- any public detach RPC/control-plane entry point
- any gateway status schema redesign
- any TUI detach UX
- any daemon lifecycle/stop/restart/disconnect work
- any session/client subscription cleanup
- any broader transport redesign

Phase 1 is complete once the attachment boundary owns releasable daemon forwarding bindings. That condition is now satisfied.
