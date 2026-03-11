# Session 108: Detach Control-Plane Entrypoint

## Scope

Session 108 completes Phase 3 of the daemon detach/unsubscribe capability block by wiring one existing admin/runtime control-plane surface to the completed Phase 2 internal detach seam.

This session does not redesign transport, daemon IPC, bootstrap, scheduler behavior, provider execution, TUI behavior, or daemon process lifecycle. It adds one narrow request path only.

## Control-Plane Entrypoint Added

The new entrypoint is:

- `internal.runtime.daemon.detach`

It is registered inside `src/gateway/rpc/handlers/internal-runtime-handlers.ts` only when the runtime composition provides a detach callback. `GatewayRuntimeRpcSurface` now provides that callback from the existing gateway-owned runtime RPC composition path.

That makes detach reachable through the current admin-only internal runtime RPC surface without introducing a second subsystem or a second detach implementation.

## How It Reaches the Existing Internal Detach Seam

`GatewayRuntimeRpcSurface` now supplies one local callback:

1. call `this.daemonAttachment.detach()`
2. immediately return `this.daemonAttachment.getOperationState()`

`GatewayDaemonAttachment.detach()` remains the only implementation of detach behavior. The new RPC method is just a control-plane trigger for that owner seam.

No daemon-side unsubscribe protocol was added. No extra transport command or IPC message was introduced.

## Idempotency Semantics

The new control-plane path inherits the existing Phase 2 idempotency semantics because it calls the same seam directly:

- the grouped daemon event-forwarding binding is released at most once
- attachment lifecycle resets to the existing detached snapshot when a daemon is attached
- repeated `internal.runtime.daemon.detach` calls after detach are a no-op and return the same detached operation-state projection

## Support Reporting

Support reporting changed minimally:

- `detachSupported` now reports `true`
- `unsubscribeSupported` remains `false`

This change is justified because detach is now actually reachable through an existing outward-facing capability surface: the admin-only internal runtime RPC surface. The response shape did not change; only the support-flag value changed to match reachable behavior.

## Public Semantics Intentionally Preserved

Session 108 intentionally preserves:

- existing attach behavior on `GatewayDaemonAttachment.connect(...)`
- existing event payload shapes
- existing status payload field names
- existing daemon detach phase names, including `attached-awaiting-daemon-unsubscribe`
- existing absence of daemon-side unsubscribe semantics
- existing runtime/gateway outward behavior outside this one detach request path

The only intended outward semantic change is that the current detach status projection now truthfully reports detach support and the new internal admin RPC can invoke it.

## Validation

Targeted validation for this session covered:

- `test/gateway/integration/gateway-daemon-attachment.test.ts`
- `test/gateway/integration/gateway-daemon-detach-operations.test.ts`
- `test/gateway/rpc/internal-runtime-handlers.test.ts`
- `test/gateway/gateway-runtime-rpc-surface-ownership.test.ts`
- `npx tsc -p tsconfig.json --noEmit`

The handler test specifically validates that `internal.runtime.daemon.detach` reaches `GatewayDaemonAttachment.detach()`, releases forwarding, resets lifecycle state, stays idempotent on repeated calls, and still allows re-attach on the existing path afterward.

## Explicitly Out Of Scope After Phase 3

The following remain out of scope after Phase 3:

- TUI detach UX
- daemon-side unsubscribe acknowledgement or protocol work
- transport reconnect/disconnect policy
- stop/restart/kill/process-control semantics
- transport-health semantics on detach
- broader session/client subscription cleanup
- broad status schema redesign
- broader daemon lifecycle redesign
