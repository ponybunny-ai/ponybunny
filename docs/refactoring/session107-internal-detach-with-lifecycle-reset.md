# Session 107: Internal Detach With Lifecycle Reset

## Scope

Session 107 completes the chosen Phase 2 slice from Session 106:

- one internal-only detach seam owned by `GatewayDaemonAttachment`
- grouped daemon-event forwarding release through the Phase 1 binding seam
- lifecycle reset back to the existing detached projection

This session does not add a public/system/admin detach RPC, does not change RPC or event payload shapes, does not change `detachSupported` / `unsubscribeSupported`, and does not broaden into transport, scheduler, bootstrap, or TUI work.

## Internal Detach Seam Introduced

`src/gateway/integration/gateway-daemon-attachment.ts` now owns one local `detach()` operation.

That method is the single Phase 2 detach seam. Its behavior is intentionally narrow:

1. release the current grouped `forwardingBinding` if one exists
2. clear the attachment-owned binding reference
3. reset `GatewayDaemonLifecycle` to its existing detached state if a daemon is attached

No second detach path was added. Attach ownership stays in `GatewayDaemonAttachment.connect(...)`, and detach ownership now stays in `GatewayDaemonAttachment.detach()`.

## Grouped Forwarding Release

Phase 1 already made `registerDaemonEventForwarders(...)` return a grouped `DaemonEventForwardingBinding`.

Session 107 is the first slice that actually invokes that seam from its intended owner:

- `GatewayDaemonAttachment` stores the grouped binding for the current attachment
- `GatewayDaemonAttachment.detach()` calls `forwardingBinding.release()`
- the binding field is then set back to `null`

This keeps daemon callback registry ownership inside the daemon event emitter while making gateway-owned forwarding cleanup callable from the current attachment boundary.

## Lifecycle Reset

`src/gateway/integration/gateway-daemon-lifecycle.ts` now exposes `resetToDetached()`.

That reset is intentionally narrow:

- clear the live daemon reference
- clear `connectedAt`
- return the same detached snapshot shape used before any attach

After detach, lifecycle-derived helpers continue to project the existing detached state:

- attachment status: `phase: 'detached'`, `connected: false`, `connectedAt: null`
- detach status: `phase: 'idle'`, `attached: false`

No new detach-progress, detach-error, or partial-detach status values were introduced.

## Idempotency Semantics

The Phase 2 detach operation is local, synchronous, and idempotent.

- If a grouped binding exists, it is released exactly once and the stored reference is cleared.
- If lifecycle still has an attached daemon, it is reset to detached.
- If detach is called again after the binding is already cleared and lifecycle is already detached, it is a no-op.

This prevents the main attachment path from entering a half-detached state where forwarding is released but lifecycle still reports attached.

## Public Semantics Intentionally Preserved

Session 107 intentionally preserves the current public compatibility surface:

- `GatewayDaemonDetachStatus` field names and shape are unchanged
- `detachSupported` remains `false`
- `unsubscribeSupported` remains `false`
- current RPC payload shapes are unchanged
- current event payload shapes are unchanged
- current gateway/runtime outward status surfaces still derive from the same attachment/detach helper shapes

The only semantic change is internal: after the new owner-facing detach seam runs, those existing public helpers now project the same detached state they already used before attach.

## Validation

Targeted validation covered the directly affected seam:

- `test/gateway/integration/gateway-daemon-attachment.test.ts`
  - grouped forwarding is released by internal detach
  - lifecycle/status reset to detached after internal detach
  - repeated detach is idempotent
  - attach still works afterward on the existing `connect(...)` path
- `test/gateway/integration/gateway-daemon-lifecycle.test.ts`
  - lifecycle reset returns the existing detached snapshot
- `test/gateway/integration/gateway-daemon-detach-operations.test.ts`
  - detach-facing status projection returns to the existing idle shape after reset
- `test/gateway/integration/daemon-event-forwarding.test.ts`
  - grouped release behavior remains intact
- `npx tsc -p tsconfig.json --noEmit`

## Remaining Phase 3 Work Out Of Scope

Phase 3 remains explicitly out of scope for Session 107:

- whether any public/control-plane detach command should exist
- whether a daemon-side unsubscribe command or acknowledgement is needed
- whether support flags should ever become true
- any system/admin/internal-runtime handler work
- any TUI detach UX
- any transport reconnect/disconnect policy
- any daemon process stop/restart/kill semantics
- any broader daemon lifecycle redesign

The next session can review this completed internal Phase 2 seam and decide whether Phase 3 should stay internal-only or add a narrowly scoped external control surface.
