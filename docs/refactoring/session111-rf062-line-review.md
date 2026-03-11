# Session 111: RF-062 Line Review

## Scope

Session 111 is a bounded review / re-ranking session for `RF-062` after the first major coding cluster landed in Session 110.

This session is documentation only. It does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume the paused Sessions 95-100, 101-103, or 104-109 lines
- redesign gateway/daemon transport semantics
- redesign provider execution or fallback behavior
- redesign startup/bootstrap behavior
- redesign daemon detach capability
- redesign TUI behavior
- change RPC/event/status payload shapes
- perform broad package/module-boundary cleanup

The goal is to decide whether `RF-062` still has one more clearly high-value, tightly bounded, semantics-preserving next coding cluster, or whether this line should pause now and yield priority to another live project block.

## Reviewed Codebase Surfaces

Primary current-code surfaces reviewed for this decision:

- `src/gateway/gateway-server.ts`
- `src/gateway/runtime/gateway-tool-provider-runtime-cluster.ts`
- `src/gateway/runtime/gateway-tool-provider-runtime.ts`
- `src/gateway/runtime/gateway-runtime-rpc-surface.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `src/gateway/rpc/handlers/internal-runtime-handlers.ts`
- `test/gateway/runtime/gateway-tool-provider-runtime-cluster.test.ts`
- `test/gateway/gateway-tool-provider-runtime-ownership.test.ts`
- `test/gateway/gateway-runtime-rpc-surface-ownership.test.ts`
- `docs/refactoring/session109-detach-capability-line-review.md`
- `docs/refactoring/session110-rf062-tool-provider-runtime-wiring.md`

For practical re-ranking beyond `RF-062`, the current live `RF-030` materialization path was also checked in:

- `src/scheduler-daemon/session-intake.ts`
- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `src/app/conversation/session-manager.ts`

## What Session 110 Actually Achieved

Session 110 made one real structural change and it landed on the right target.

### 1. The `GatewayToolProviderRuntime` assembly/publication cluster is now explicit

`src/gateway/runtime/gateway-tool-provider-runtime-cluster.ts` now owns the bounded assembly step that:

- constructs `GatewayToolProviderRuntime`
- constructs `GatewayRuntimeRpcSurface`
- publishes only `toolProviderRuntime.toolRegistry` into the adjacent runtime/control surface

That means the publication decision is no longer mixed directly into `GatewayServer`.

### 2. The mixed inline construction/publication path was removed from `GatewayServer`

In the current `src/gateway/gateway-server.ts`, the constructor now only asks the helper for a cluster result and stores the two live runtime owners:

- `this.toolProviderRuntime = toolProviderRuntimeCluster.toolProviderRuntime`
- `this.runtimeRpcSurface = toolProviderRuntimeCluster.runtimeRpcSurface`

The touched path no longer performs inline:

- `GatewayToolProviderRuntime` construction
- `GatewayRuntimeRpcSurface` construction
- `toolRegistry` publication into the runtime/control surface
- redundant local ownership of `toolRegistry`, tool allowlist, or tool enforcer fields

### 3. What intentionally remained inline as true steady-state `GatewayServer` ownership

What remained inline after Session 110 still looks like real live server ownership rather than unresolved mixed graph assembly:

- `GatewayServer` keeps the live `toolProviderRuntime` field
- `GatewayServer` keeps the live `runtimeRpcSurface` field
- `GatewayServer.registerHandlers()` still controls registration timing and calls `this.runtimeRpcSurface.register()`
- `GatewayServer.getStats()` still uses the runtime-RPC surface status snapshot as part of the server's own outward stats API
- lifecycle/start/stop/restart, daemon attachment, scheduler attachment, config-watch reaction, and transport-facing behavior remain server-owned

That remaining shape is materially different from the pre-110 constructor knot. The biggest tool/provider-adjacent publication seam has already been removed from the live server.

## Current Structural State After Session 110

The most important review result is negative:

- there is no remaining `GatewayServer`-local tool/provider publication seam comparable to the one Session 110 extracted
- the server no longer owns `toolRegistry`, tool allowlist, or tool enforcer pass-through fields on the touched path
- the remaining pressure sits either inside the already-extracted `GatewayRuntimeRpcSurface` helper or in server-owned lifecycle/registration behavior that was already classified as steady-state ownership during the `RF-061` closure review

So the question is no longer "is there still one more mixed `GatewayServer` tool/provider cluster?" The answer to that specific question is now no.

## Plausible Remaining RF-062 Candidates

Only candidates grounded in the current tree are included here.

### Candidate 1: `GatewayRuntimeRpcSurface.register()` still carries the remaining caller-side publication bundle

Current code:

- `src/gateway/runtime/gateway-runtime-rpc-surface.ts` still assembles the `registerSystemHandlers(...)` and `registerInternalRuntimeHandlers(...)` dependency bundles in one method
- this includes the remaining `toolRegistry` publication into both handler families, plus rollout callbacks, channel-update bridging, realtime metrics, daemon detach callback wiring, and model-override forwarding/fallback hooks

This is the most plausible remaining `RF-062` candidate because it is the only place that still looks like a small service-wiring bundle rather than pure runtime lifecycle behavior.

Evaluation:

- Structural gain: modest. Splitting this further would reduce concentration inside an already-correct helper, but it would not remove another meaningful mixed cluster from `GatewayServer`.
- Semantic risk: low to moderate. The handler contracts are already stable, but this path is behavior-adjacent because it wires rollout forwarding, daemon detach reachability, runtime-config reads, channel updates, and scheduler model-override reads.
- Scope tightness: reasonably tight.
- Is it truly still ownership/composition/wiring cleanup: partly yes. This is still callback/dependency publication code, not core handler implementation.
- Drift risk: high. A follow-up here would mostly subdivide `GatewayRuntimeRpcSurface`, which starts to look like reopening `RF-061` for helper-internal normalization rather than extracting another meaningful live-server seam.

Judgment:

This is a real remaining concentration, but it is second-order. After Session 110 it no longer looks strong enough to justify another immediate coding session on `RF-062`.

### Candidate 2: `GatewayRuntimeRpcSurface` status/config/model-override helper methods

Current code:

- `getGatewayStatusSnapshot()`
- `getInternalRuntimeConfig()`
- `detachDaemon()`
- `setAgentModelOverride(...)`
- `getAgentModelOverride(...)`

These methods still mix status projection, runtime-config reads, detached-path fallback behavior, and IPC forwarding inside the same helper.

Evaluation:

- Structural gain: low. Extracting these would mostly produce smaller helper objects around already-small methods.
- Semantic risk: moderate. The model-override fallback path reads runtime config when the scheduler daemon is disconnected, so even a semantics-preserving refactor would be close to the paused source-of-truth/model-override area.
- Scope tightness: tight, but almost too tight to be valuable.
- Is it truly still ownership/composition/wiring cleanup: only partly. Much of this is now local behavior/projection logic inside the helper rather than a live assembly seam.
- Drift risk: high. This can easily slide into `RF-061` reopening, model-override/source-of-truth cleanup, or runtime-config normalization rather than staying inside `RF-062`.

Judgment:

This is not the right next cluster. It is too small structurally and too close to adjacent semantic areas.

### Candidate 3: `GatewayServer` still owns runtime-RPC registration timing and status pass-through

Current code:

- `GatewayServer.registerHandlers()` still calls `this.runtimeRpcSurface.register()`
- `GatewayServer.getStats()` still reaches through `this.runtimeRpcSurface.getGatewayStatusSnapshot()`

This is a plausible candidate only in the weakest sense: it is still adjacent to the same helper pair and could be normalized further.

Evaluation:

- Structural gain: very low. This would mostly move one call site and one status read.
- Semantic risk: low to moderate because registration timing and outward stats are part of the live gateway lifecycle/API surface.
- Scope tightness: tight.
- Is it truly still ownership/composition/wiring cleanup: mostly no. This now reads as steady-state server ownership and lifecycle timing.
- Drift risk: very high. Pursuing this would be cosmetic `GatewayServer` normalization and a de facto reopening of the `RF-061` closure judgment.

Judgment:

This should not be treated as an `RF-062` follow-up target.

## Conclusion

`RF-062` should pause now.

After Session 110, there is not one more clearly high-value, tightly bounded, semantics-preserving coding cluster inside this line.

The reason is not that absolutely no further cleanup is possible. The reason is that the remaining candidates have crossed below the threshold that justified Session 110:

- the big `GatewayServer`-local tool/provider assembly/publication knot is already gone
- the remaining pressure is helper-internal rather than live-server-local
- the strongest remaining candidate would mostly split `GatewayRuntimeRpcSurface` for neatness rather than remove another materially confusing ownership seam
- the weaker remaining candidates either reopen `RF-061`, drift toward model/source-of-truth cleanup, or amount to cosmetic `GatewayServer` normalization

So the honest decision here is diminishing returns, not forced continuation.

## Practical Re-Ranking Against Broader Remaining Candidates

If `RF-062` pauses now, the broader live candidates in the task list rank approximately as follows.

### 1. RF-030 conversation materialization decoupling

This is now the best next major block.

Why:

- it is still medium priority and still planned rather than paused
- the live code still has a real semantic bridge: `SessionManager` calls `taskBridge.createGoalFromConversation(...)`, subscribes to task progress, and reads task status, while `SchedulerTaskBridge` still directly creates the goal, creates the first work item, and submits the goal to the scheduler
- that is a more substantial remaining ownership boundary than the helper-internal micro-seams left under `RF-062`

### 2. RF-024 tool mode switch

Not the right next move.

Why:

- it is low priority
- Session 39 already concluded a formal mode switch should not exist yet
- pushing it now would be more speculative than the still-live `RF-030` materialization boundary

### 3. RF-036 event protocol cleanup

Still lower priority.

Why:

- it is explicitly low priority
- it is protocol-normalization work, not the next highest structural ownership seam

### 4. RF-026 tool hardening

Keep deferred.

Why:

- the task list still marks it deferred until a non-local tool topology is justified
- nothing in the current tree suggests that condition has changed

## What Should Not Be Done Next

- Do not split `GatewayRuntimeRpcSurface` just to move the remaining callback/options bundle into another thin helper.
- Do not treat duplication of `() => this.toolRegistry` across `registerSystemHandlers(...)` and `registerInternalRuntimeHandlers(...)` as if it were a new major cluster.
- Do not move `this.runtimeRpcSurface.register()` or the server stats/status pass-through out of `GatewayServer` just for symmetry.
- Do not reopen `RF-061` by trying to normalize the rest of `GatewayServer` after Session 110.
- Do not drift from this wiring review into provider-manager redesign, runtime-tooling-context/global-tool unification, startup/bootstrap redesign, daemon detach follow-up, or TUI/reporting cleanup.
- Do not widen the next session into broad `system-handlers.ts` or `internal-runtime-handlers.ts` internals cleanup.

## Recommended Session 112

Recommend exactly one next session:

Start `RF-030` with a bounded review/design session centered on:

- `src/scheduler-daemon/session-intake.ts`
- `src/app/conversation/session-manager.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`

The purpose of that session should be to identify the smallest semantics-preserving first boundary for conversation-triggered goal/work-item materialization, rather than immediately coding a broad change.

That is a better use of the next session than forcing one more weaker `RF-062` slice.

## Validation

Validation for Session 111 was intentionally review-oriented:

- reviewed the current post-110 gateway/runtime wiring files listed above
- reviewed the focused ownership/cluster tests covering the Session 110 extraction
- reviewed the current live `RF-030` materialization path for re-ranking
- confirmed this session remains documentation-only and does not require runtime-code validation

No runtime code changes were made in this session.
