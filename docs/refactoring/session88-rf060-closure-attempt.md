# Session 88: RF-060 Closure Attempt

This session reviewed the remaining startup-adjacent assembly and sequencing around `GatewayServer`, selected one closure-oriented consolidation cluster, and implemented it without changing gateway, daemon, scheduler, IPC, replay, or public runtime behavior.

The result is that RF-060 can be closed: the remaining startup/bootstrap ownership lines are now explicit enough across the gateway CLI/process entrypoint, gateway bootstrap helper, and `GatewayServer` runtime owner that the residual constructor work in `GatewayServer` is better classified as true runtime-owned component construction rather than active startup/bootstrap debt.

## Reviewed Surfaces

- `src/gateway/gateway-server.ts`
- `src/gateway/bootstrap/default-gateway-runtime.ts`
- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` (new in this session)
- `src/cli/commands/gateway.ts`
- `src/gateway/public.ts`
- `src/gateway/compatibility.ts`
- `src/gateway/index.ts`
- `src/gateway/config/config-watcher.ts`
- `src/gateway/debug-broadcaster.ts`

## Role Classification

| Surface | Classification | Notes |
|---|---|---|
| `src/cli/commands/gateway.ts` | true gateway process/CLI entrypoint | Owns foreground/background/daemon process supervision, PID/log files, local pairing-token operations, and process-level command routing. |
| `src/gateway/bootstrap/default-gateway-runtime.ts` | true gateway startup/bootstrap helper | Owns default persistence assembly and default `GatewayServer` construction for the live gateway startup path. |
| `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` | true gateway startup/bootstrap helper | New helper that owns startup-only and shutdown-only runtime sequencing: config-watch activation, runtime-event-store attachment, startup channel activation, IPC startup, debug-broadcaster activation, and startup banner/reporting. |
| `src/gateway/gateway-server.ts` | true runtime-owned gateway behavior | Owns live gateway components, handler registration, steady-state routing, daemon/scheduler attachment, runtime status, and runtime-facing APIs. After this session it delegates startup-only sequencing instead of inlining it. |
| `src/gateway/public.ts` | true public entrypoint | Intended live gateway API surface. Not a startup module. |
| `src/gateway/compatibility.ts` | compatibility/public-surface concern | Intentional compatibility-only exports. Not startup-owned. |
| `src/gateway/index.ts` | compatibility/public-surface concern | Historical mixed barrel kept intentionally thin. |
| `src/gateway/config/config-watcher.ts` | startup-activated runtime service | The watcher remains gateway-owned runtime infrastructure, but its activation/deactivation is startup/shutdown sequencing rather than constructor-time assembly. |
| `src/gateway/debug-broadcaster.ts` | startup-activated runtime service | The broadcaster remains a runtime-owned gateway facility, but enabling/disabling it is startup/shutdown sequencing rather than core `GatewayServer` behavior. |

## Selected Consolidation Cluster

The highest-value remaining closure cluster was:

- extract startup-only and shutdown-only runtime sequencing out of `GatewayServer`
- make that sequencing explicit in a gateway bootstrap helper adjacent to `default-gateway-runtime.ts`
- keep `GatewayServer` as the runtime owner while narrowing it away from startup choreography

This cluster was chosen because Session 87 had already clarified the gateway CLI/process entrypoint versus default runtime assembly. The remaining ambiguity was now concentrated in `GatewayServer.start()` / `stop()` and a small constructor-adjacent startup path:

- startup-only activation of config watching
- startup-only runtime event-store binding
- startup-only startup channel activation and status publication
- startup-only IPC server bring-up and bridge hookup
- startup-only debug broadcaster activation
- startup-only startup banner/reporting
- shutdown-only teardown ordering for those same services

Those concerns were real startup/bootstrap sequencing concerns, not steady-state behavior, so they were the right final RF-060 target.

## What Changed

Added `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`.

That new helper now owns:

- default scheduler-socket-path resolution for the live gateway startup path
- gateway runtime startup sequencing
- gateway runtime shutdown sequencing
- startup banner/reporting

`src/gateway/gateway-server.ts` now:

- keeps ownership of component construction, handler registration, runtime state, and live gateway APIs
- delegates startup-only sequencing to `startGatewayServerRuntimeLifecycle(...)`
- delegates shutdown-only sequencing to `stopGatewayServerRuntimeLifecycle(...)`
- configures a config watcher during construction only when requested, but no longer starts it in the constructor
- accepts optional `schedulerSocketPath` in `GatewayServerDependencies` so the bootstrap helper can pass startup-owned socket resolution explicitly

`src/gateway/bootstrap/default-gateway-runtime.ts` now passes the default scheduler socket path explicitly into `GatewayServer` construction for the live bootstrap path.

## What Was Re-Routed Or Clarified

Re-routed:

- `GatewayServer.start()` runtime bootstrap sequencing into `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
- `GatewayServer.stop()` runtime shutdown sequencing into the same helper
- default scheduler socket-path resolution through the gateway bootstrap path

Clarified:

- `src/cli/commands/gateway.ts` remains the process/CLI entrypoint
- `src/gateway/bootstrap/default-gateway-runtime.ts` remains the default runtime composition helper
- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` is the startup/shutdown sequencing helper
- `GatewayServer` is the runtime owner, not the gateway bootstrap choreographer

## Remaining Startup/Public/Compatibility Surfaces

These remain intentionally as-is:

- `src/gateway/public.ts`: live public surface
- `src/gateway/compatibility.ts`: compatibility-only surface
- `src/gateway/index.ts`: thin mixed historical barrel
- `GatewayServer` constructor component construction: acceptable runtime ownership, because these objects are part of the server's steady-state runtime graph rather than process-entrypoint or default-bootstrap composition debt

The constructor still contains runtime-owned assembly such as event bus, routing, auth, audit, tool registry, channel stores, and adapter instances. After this session, that remaining work is no longer ambiguous startup/bootstrap logic; it is the gateway runtime assembling its own internal runtime graph.

## Intentionally Postponed

- pairing-token schema helpers in `src/cli/commands/gateway.ts`, which are operational helpers rather than the selected startup/bootstrap cluster
- broader runtime-core singleton/tooling cleanup outside RF-060
- any daemon, scheduler, replay, or transport-boundary redesign
- any public/compatibility surface deletion

## RF-060 Closure Judgment

`RF-060` is closed.

Why closure is justified:

- the gateway CLI/process entrypoint is explicit and thin with respect to runtime assembly
- the default gateway bootstrap helper is explicit and owns default persistence/server assembly
- startup-only runtime sequencing is now explicit in a gateway bootstrap helper instead of mixed into `GatewayServer`
- remaining `GatewayServer` work is classifiable as true runtime ownership rather than hidden composition-root logic
- compatibility/public surfaces remain intentionally thin and are no longer part of the startup ambiguity

No additional follow-up row is needed for RF-060. Any future cleanup in gateway runtime internals would belong to a different concern, not unresolved startup/bootstrap composition-root rationalization.

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
- startup/bootstrap ownership improvements established in Sessions 86-87
- outer transport ownership lines
- durable ownership lines
- current scheduler behavior
- current daemon startup behavior
- current gateway startup behavior
- current replay behavior
- current direct vs evented execution semantics
- current `runtimeEventBus` semantics and ownership
- current persistence semantics
- current public runtime behavior
- current attach/connect and detach/unsubscribe semantics

## Validation Summary

Targeted validation run:

- `npx jest test/gateway/bootstrap/default-gateway-runtime.test.ts test/gateway/bootstrap/gateway-server-runtime-lifecycle.test.ts test/gateway/gateway-startup-runtime-ownership.test.ts test/cli/gateway-startup-surface.test.ts`
- `npm run build`

Validation results:

- all four targeted Jest suites passed
- project build passed
- focused source/usage scans confirmed:
  - `GatewayServer` now imports the startup lifecycle helper instead of inlining startup sequencing
  - `default-gateway-runtime.ts` now passes explicit scheduler socket-path bootstrap input into `GatewayServer`
  - the CLI startup path remains routed through the explicit gateway bootstrap helper
