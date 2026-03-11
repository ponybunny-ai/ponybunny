# Session 87: Gateway Startup/Bootstrap Rationalization

This session continued `RF-060` by reviewing the gateway startup/bootstrap area adjacent to the CLI process entrypoint, gateway public/compatibility surfaces, and `GatewayServer`, then implementing one bounded consolidation cluster.

The goal was to reduce ambiguity between:

- the true gateway process/CLI entrypoint
- the true startup/bootstrap composition root
- the runtime-owned `GatewayServer`
- the already-closed public/compatibility export surfaces

No gateway runtime semantics, IPC payloads, attach/detach behavior, replay behavior, scheduler behavior, or daemon behavior were changed.

## Reviewed Surfaces And Role Classification

| Surface | Classification | Notes |
|---|---|---|
| `src/cli/commands/gateway.ts` | true gateway process/CLI entrypoint with mixed startup assembly | Owns background/daemon process supervision, PID/log lifecycle, operational CLI commands, and before this session also owned default gateway DB/repository/server assembly inline in `runGateway(...)`. |
| `src/gateway/gateway-server.ts` | true runtime-owned behavior module with startup-adjacent internal assembly | Live gateway runtime owner. It still constructs and starts its internal components, but that is a separate runtime-owner vs internal assembly follow-up from the CLI/bootstrap split addressed here. |
| `src/gateway/public.ts` | true public entrypoint | Intended live gateway API surface. Not a startup module. |
| `src/gateway/compatibility.ts` | compatibility/public-surface concern | Intentional compatibility-only exports. Not startup-owned. |
| `src/gateway/index.ts` | compatibility/public-surface concern | Historical mixed barrel that stays intentionally thin. |
| `src/gateway/bootstrap/default-gateway-runtime.ts` | true startup/bootstrap composition root | New explicit gateway startup helper introduced in this session. Owns default persistence and `GatewayServer` assembly for the live gateway startup path. |
| gateway CLI pairing-token helpers in `src/cli/commands/gateway.ts` | adjacent non-startup operational helpers | They still apply schema inline for auth-token management. They are not part of the selected startup/bootstrap cluster. |

## Selected Consolidation Cluster

The highest-value first gateway cluster was:

- extract default gateway runtime assembly out of `src/cli/commands/gateway.ts`
- make that assembly explicit under `src/gateway/bootstrap/`
- reroute gateway process startup and shutdown through that bootstrap helper

This cluster was chosen because it addressed the clearest still-live startup ambiguity after Session 86:

- `src/cli/commands/gateway.ts` is a true process entrypoint, but it was also a composition root
- inline startup assembly there blurred process management responsibilities with gateway runtime wiring
- the public/compatibility surfaces were already intentionally thin after Sessions 83-85, so they were not the right target
- changing `GatewayServer` internals first would have widened the session into runtime-owner refactoring instead of the cleaner first composition-root move

## What Changed

Added `src/gateway/bootstrap/default-gateway-runtime.ts` as an explicit gateway startup/bootstrap module.

That new helper now owns:

- default gateway persistence assembly
- gateway and memory schema application for the startup path
- default `WorkOrderDatabase` creation/initialization for the startup path
- default `GatewayServer` creation for the startup path
- shutdown cleanup for the assembled runtime, including repository and SQLite handles

`src/cli/commands/gateway.ts` now:

- remains the gateway process/CLI entrypoint
- still owns foreground/background/daemon startup mode selection
- still owns PID files, logging, stop/status/ps/logs/token operations, and daemon supervision
- no longer directly constructs `WorkOrderDatabase` or `GatewayServer` inside `runGateway(...)`
- routes live startup and shutdown through `createDefaultGatewayRuntime(...)` and `stopDefaultGatewayRuntime(...)`

The CLI entrypoint was also narrowed to import:

- `Permission` from the explicit live gateway public surface
- the startup helper from the explicit gateway bootstrap surface

instead of pulling runtime assembly directly from the historical mixed gateway barrel.

## What Moved / Re-Routed / Narrowed

Moved:

- default gateway DB/repository/server assembly from inline CLI code into `src/gateway/bootstrap/default-gateway-runtime.ts`

Re-routed:

- gateway foreground runtime startup through `createDefaultGatewayRuntime(...)`
- gateway foreground shutdown cleanup through `stopDefaultGatewayRuntime(...)`

Narrowed:

- `src/cli/commands/gateway.ts` toward process-entrypoint responsibilities
- the startup path’s dependency route so runtime assembly no longer hangs directly off the CLI command body

## Remaining Startup/Public/Compatibility Surfaces

These remain intentionally unchanged:

- `src/gateway/public.ts`: true live public surface and not a startup module
- `src/gateway/compatibility.ts`: intentional compatibility-only route
- `src/gateway/index.ts`: thin historical mixed barrel kept for compatibility
- `src/gateway/gateway-server.ts`: remains the gateway runtime owner; internal startup-adjacent assembly inside the class was not moved in this session because that is a separate runtime-owner cleanup

## Intentionally Postponed

- any extraction of internal component assembly or startup sequencing out of `src/gateway/gateway-server.ts`
- any redesign of gateway runtime ownership or IPC behavior
- any broad cleanup of non-startup operational commands in `src/cli/commands/gateway.ts`
- any compatibility-surface deletion or root-barrel cleanup
- any daemon or scheduler redesign

## Block Status

`RF-060` still looks multi-session after this gateway cleanup, but it is narrower now.

The gateway process-entrypoint vs startup-bootstrap distinction is materially clearer after this session. The remaining debt in this block is now more concentrated inside `src/gateway/gateway-server.ts`, where runtime ownership and internal startup-adjacent component assembly are still mixed.

This means the block is approaching closure structurally, but it is not closed yet.

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
- startup/bootstrap ownership improvements established in Session 86
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

- `npx jest test/gateway/bootstrap/default-gateway-runtime.test.ts test/cli/gateway-startup-surface.test.ts`
- `npm run build`
- focused import/usage scan on `src/cli/commands/gateway.ts` and `src/gateway/bootstrap/default-gateway-runtime.ts`

Validation results:

- both targeted Jest checks passed
- the build passed
- the usage scan confirmed `src/cli/commands/gateway.ts` now routes startup through the new bootstrap helper and no longer directly imports `GatewayServer` or `WorkOrderDatabase` for the live gateway startup path

One discarded validation attempt occurred during the session:

- an initial executable bootstrap-helper Jest test failed because Jest hit a pre-existing ESM-transformation limitation in a transitive `GatewayServer` dependency chain (`@noble/ed25519` under the current Jest config)
- the helper code itself still passed project build validation, and the final targeted tests were adjusted to verify the routing/surface split without widening into Jest ESM-configuration work

## Recommended Next Session

Stay inside `RF-060` and review whether the remaining internal startup-adjacent assembly inside `src/gateway/gateway-server.ts` should be partially extracted behind a narrower gateway-owned runtime bootstrap/helper seam.

The next session should focus on one bounded cluster only, likely:

- startup sequencing or internal component assembly that is clearly composition-root logic rather than steady-state runtime ownership

It should not reopen:

- public/compatibility surface work
- daemon startup work already improved in Session 86
- transport-boundary work
- broader package-architecture cleanup
