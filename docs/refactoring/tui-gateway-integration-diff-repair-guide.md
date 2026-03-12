# TUI Gateway Integration Diff / Repair Guide

## Purpose

This document is a future-facing repair guide for the separate TUI fix line.

It is grounded in:

- the current live gateway/scheduler behavior validated in Sessions 134-136
- the current gateway-side RPC/event/auth code
- the current TUI client/bootstrap code

It is not a gateway/scheduler redesign plan.
It is not a TUI implementation session.

## Current Live Backend Baseline Already Proven

The following backend behavior is already validated on the current refactored system:

- gateway foreground startup works
- scheduler foreground startup works
- gateway and scheduler connect over the live IPC socket
- one real `goal.submit` flow works end to end
- one real `agent.command.submit` flow works end to end
- terminal reporting through `goal.status`, `workitem.byGoal`, and `workitem.runs` works on those validated paths

This means future TUI repair should start from the assumption that the gateway/scheduler core is operational and that the client must align to the live contract rather than reopen backend refactor lines by default.

## Current Gateway/Client Contract The TUI Should Assume

### Transport and topology

- the TUI talks only to the gateway WebSocket server
- the scheduler is behind the gateway and is not a direct client connection target
- `goal.submit` and `agent.command.submit` require a connected scheduler daemon on the gateway side

### Authentication path

- loopback/local WebSocket clients are auto-authenticated by `GatewayServer.handleConnection(...)`
- non-local clients must authenticate through `auth.token` or `auth.hello` / `auth.verify`
- only `system.ping` and `system.info` are public before authentication
- all useful TUI bootstrap RPCs require an authenticated session
- `internal.runtime.config` is currently admin-only, so any remote TUI bootstrap path must verify it has admin permission if it still calls that method during startup

### Authoritative live event families

The live gateway protocol is the explicit authoritative set in `src/gateway/types.ts` and `src/gateway/events/broadcast-manager.ts`.

The TUI/client should treat these as primary:

- `goal.created`
- `goal.started`
- `goal.updated`
- `goal.completed`
- `goal.failed`
- `goal.cancelled`
- `goal.deleted`
- `workitem.created`
- `workitem.started`
- `workitem.in_progress`
- `workitem.ended`
- `workitem.updated`
- `workitem.completed`
- `workitem.failed`
- `run.started`
- `run.completed`
- `verification.started`
- `verification.completed`
- `conversation.*`
- `channel.adapter.*`
- `llm.stream.*`

Compatibility-only `task.*` events still exist as consumer-side compatibility helpers, but they are not the authoritative live gateway protocol.

### Status/reporting surfaces

The current live backend already proves these surfaces are meaningful:

- `goal.status`
- `workitem.byGoal`
- `workitem.runs`
- `system.capabilities`
- `internal.runtime.config`

For scheduler/gateway liveness checks, inspect the current server contract carefully:

- `system.status` is the richer scheduler/gateway status surface registered in `system-handlers.ts`
- `system.stats` is still a small built-in gateway method in `gateway-server.ts`, not the richer scheduler-aware status payload

## Confirmed Working Operational Paths To Preserve During TUI Repair

### Startup/runtime connectivity

- gateway startup and scheduler startup are already validated on isolated live runs
- scheduler attachment to the gateway socket is already validated
- the TUI repair line should not treat basic gateway/scheduler startup as the suspected blocker unless it reproduces a new regression

### `goal.submit`

Confirmed working behavior:

- authenticated live gateway RPC submission succeeds
- the goal is materialized and auto-submitted
- scheduler picks up the work item
- work-item execution completes
- terminal goal/work-item reporting is coherent

### `agent.command.submit`

Confirmed working behavior:

- authenticated live gateway RPC submission succeeds
- gateway-owned loaded-definition / materialization path succeeds
- daemon handoff succeeds
- scheduler execution and verification succeed
- terminal goal/work-item/run reporting is coherent

The future TUI repair line should keep these backend-proven paths intact and use them as comparison targets when diagnosing client behavior.

## Known Non-Blocking Residue That Should Not Be Mistaken For The Main TUI Blocker

- `workitem.runs` can currently show two success runs for one successful direct-path work item; this is known duplicate direct-run reporting residue, not proof of duplicate execution failure
- auto-submitted flows can emit `goal.started` before the creator subscription exists; later events and terminal status still succeed
- isolated validation used mock-provider fallback when credentials/config were absent; that does not invalidate the gateway/scheduler contract
- sandbox socket restrictions seen during prior validation were environment-specific and not a live runtime blocker

## Concrete Current Integration Diffs To Inspect First

These are code-level client/server mismatches visible in the current tree and should be checked before any broader debugging.

### 1. `system.stats` response-shape drift

Current TUI code:

- `src/cli/gateway/tui-gateway-client.ts` exposes `getStats()` via `system.stats`
- `src/cli/tui/commands/handlers.ts` reads `schedulerConnected` from the returned object

Current server code:

- `src/gateway/gateway-server.ts` registers `system.stats` as a small built-in method that currently returns only gateway connection stats
- `src/gateway/rpc/handlers/system-handlers.ts` registers the richer scheduler-aware payload on `system.status`

Implication:

- do not assume `system.stats` currently returns scheduler connectivity or daemon state
- if the TUI depends on scheduler-connected status during bootstrap or natural-input flows, this is a concrete repair target

### 2. Escalation method-name drift

Current TUI code:

- `src/cli/gateway/tui-gateway-client.ts` calls `escalation.resolve`

Current server code:

- `src/gateway/rpc/handlers/escalation-handlers.ts` registers `escalation.respond`

Implication:

- escalation resolution from the TUI should be expected to fail until the client/server method names are reconciled

### 3. Approval method-name drift

Current TUI code:

- `src/cli/gateway/tui-gateway-client.ts` calls `approval.approve`
- `src/cli/gateway/tui-gateway-client.ts` calls `approval.reject`

Current server code:

- `src/gateway/rpc/handlers/approval-handlers.ts` registers `approval.grant`
- `src/gateway/rpc/handlers/approval-handlers.ts` registers `approval.deny`

Implication:

- approval actions from the TUI should be expected to fail until the method names are reconciled

### 4. Session-first conversation path is the normal main-TUI input path

Current TUI code:

- `src/cli/tui/commands/handlers.ts` routes natural input through `conversation.new` plus `conversation.message`
- the TUI currently enforces session-first input mode from runtime TUI config handling

Validated backend evidence:

- Sessions 135-136 validated `goal.submit` and `agent.command.submit`
- Sessions 135-136 did not validate the session-first `conversation.message` path end to end

Implication:

- if the TUI "cannot be used normally" after initial connection, inspect the conversation/session bootstrap path next

This is a likely mismatch area, but the specific failure mode there remains a hypothesis until a dedicated TUI repair session reproduces it.

### 5. Event-protocol assumptions

Current server code:

- the authoritative live broadcast set is `goal.*`, `workitem.*`, `run.*`, `verification.*`, `conversation.*`, `channel.adapter.*`, and `llm.stream.*`

Current TUI code:

- main event handling in `src/cli/tui/app.tsx` already consumes the authoritative families
- compatibility handling for `task.*` exists in `src/cli/tui/task-event-compatibility.ts`

Implication:

- future repair should not assume the fix is "restore old `task.*` as the main protocol"
- first verify that the TUI is receiving and handling the authoritative live event families correctly

## Recommended Debugging Order For The Future TUI Repair Line

1. Verify the backend baseline first.
   Confirm the gateway is listening on the expected WebSocket port and the scheduler is connected through the gateway-side status path before touching TUI code.

2. Verify raw WebSocket session establishment next.
   Use a minimal local client or logging shim to confirm the TUI process reaches authenticated state and can call `system.methods`.

3. Reproduce the exact TUI bootstrap RPC bundle in order.
   Check `conversation.list`, `goal.list`, `escalation.list`, `workitem.list`, `system.capabilities`, and `internal.runtime.config` one by one.

4. Compare every failing TUI RPC wrapper against the registered server method name and payload shape.
   Start with `system.stats`, `escalation.resolve`, `approval.approve`, and `approval.reject`.

5. After bootstrap RPC alignment, verify one known-good operational flow from the TUI side.
   Use the already proven backend paths as control cases:
   - minimal `goal.submit`
   - minimal `agent.command.submit` harness if the TUI or a debug shim can invoke it

6. Only after bootstrap and submission are aligned, inspect event/rendering behavior.
   In particular, check whether the TUI is misclassifying missing early `goal.started` as total failure on auto-submitted paths.

7. Finally inspect session-first conversation behavior.
   If the TUI still fails during normal interactive use, reproduce `conversation.new` and `conversation.message` separately and treat that as a consumer-path validation problem, not as a reason to reopen gateway/scheduler architecture work.

## Explicit Do-Not-Assume Notes

- Do not assume `system.stats` is the rich scheduler/gateway status method. Check `system.status` before concluding the scheduler is disconnected.
- Do not assume missing early `goal.started` means submission failed. Check `goal.status` and later terminal events.
- Do not assume duplicate `workitem.runs` entries mean duplicate execution. The current direct path still has known reporting residue there.
- Do not assume `task.*` is the primary live event protocol. It is compatibility-only.
- Do not assume remote clients are auto-authenticated. Only local loopback connections are.
- Do not assume the current TUI failure justifies reopening `RF-073`, `RF-060`, `RF-061`, or any paused architecture line.

## Repair-Line Goal

The future TUI repair line should be a narrow client integration effort:

- align method names and response-shape expectations with the live gateway
- verify bootstrap/auth/session assumptions against the current backend contract
- restore normal TUI usability without changing gateway/scheduler runtime semantics unless a later dedicated session proves that a backend bug is genuinely required
