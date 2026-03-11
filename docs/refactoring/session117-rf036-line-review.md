# Session 117: RF-036 Line Review

## Scope

Session 117 is a bounded review / re-ranking session only.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused source-of-truth, singleton, detach, `RF-062`, or `RF-030` lines
- redesign scheduler semantics
- redesign conversation lifecycle semantics
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport behavior
- redesign runtime worker behavior
- change provider execution/fallback behavior
- change existing RPC/event/status payload shapes
- change TUI behavior

## Files Reviewed

Primary current-code review targets:

- `src/gateway/types.ts`
- `src/gateway/public.ts`
- `src/gateway/compatibility.ts`
- `src/gateway/events/broadcast-manager.ts`
- `src/cli/tui/app.tsx`
- `src/cli/tui/task-event-compatibility.ts`
- `src/scheduler/core/scheduler.ts`
- `src/runtime/workers/execution-worker.ts`
- `src/runtime/event-bus/adapters/scheduler-event-adapter.ts`
- `src/runtime/event-bus/adapters/gateway-event-adapter.ts`

Prior session outputs reviewed:

- `docs/refactoring/session115-rf036-event-protocol-review.md`
- `docs/refactoring/session116-rf036-gateway-compatibility-boundary.md`

## What Session 116 Achieved

Session 116 completed the first major RF-036 coding cluster cleanly and in the intended place.

### 1. Legacy gateway/TUI `task.narration` / `task.result` were separated into a compatibility-only boundary

Current code now shows that separation explicitly:

- `src/gateway/types.ts` defines `GatewayEventType` as the authoritative live gateway protocol and moves `task.narration` / `task.result` into separate `GatewayCompatibilityEventType` typing
- `src/gateway/public.ts` exports the live gateway surface only
- `src/gateway/compatibility.ts` owns the compatibility-only task-event typing/helper exports
- `src/cli/tui/task-event-compatibility.ts` contains the legacy TUI handling path for compatibility senders

This resolved the specific pre-Session-116 ambiguity where gateway typing still implied that `task.narration` / `task.result` were part of the live transport contract even though current bridge and broadcast code did not emit them.

### 2. Live-vs-compatibility gateway typing was tightened

The current type surface is materially clearer than it was in Session 115:

- `GatewayEventType` is now live-only
- `GatewayCompatibilityEventType` is explicitly legacy-only
- `Subscription.eventTypes` now accepts only live gateway event types
- `BroadcastManager` accepts only live `GatewayEventType` values and documents that `task.*` compatibility events are consumer-side only

That is real protocol-boundary cleanup, not just cosmetic type pruning.

### 3. TUI legacy handling moved onto an explicit compatibility path

Current TUI handling is now structured as:

1. `src/cli/tui/app.tsx` first checks `isGatewayCompatibilityEventType(event.event)`
2. compatibility events are delegated to `handleTaskCompatibilityEvent(...)`
3. the main event switch remains focused on the authoritative live `goal.*` / `workitem.*` / `run.*` / `verification.*` flow

That preserves behavior while removing the implied claim that legacy `task.*` UX events are normal live gateway protocol.

## What Session 116 Intentionally Did Not Change

The following seams remain intentionally untouched in the current codebase:

- `task.ready` still exists as the scheduler-to-worker runtime dispatch event in `src/scheduler/core/scheduler.ts`
- `LocalExecutionWorker` still subscribes directly to `task.ready` in `src/runtime/workers/execution-worker.ts`
- scheduler-to-worker runtime dispatch semantics are unchanged
- the runtime event bus meaning of `task.ready`, `execution.started`, `execution.completed`, and `execution.failed` is unchanged
- transport behavior is unchanged: `BroadcastManager` still broadcasts only the live gateway families and does not produce compatibility `task.*` events

That untouched boundary matters because it is now the only real remaining RF-036 candidate with any structural weight.

## Plausible Remaining RF-036 Candidates

Only candidates that still exist in the current codebase are included here.

### Candidate A: bounded authoritative classification pass around the runtime-internal `task.ready` seam

Current code evidence:

- `SchedulerCore.publishTaskReady(...)` still publishes runtime event `task.ready` with the full `ExecutionRequest`
- `LocalExecutionWorker.start()` still subscribes to `task.ready`
- `LocalExecutionWorker` still parses that event as a scheduler-owned execution command and publishes `execution.*` as the authoritative result path

Why it still plausibly belongs to RF-036:

- `task.ready` is the last live `task.*` event still in active production use
- its meaning is machine-to-machine execution dispatch, not user-facing narration/result reporting
- that makes it the last remaining live place where the `task.*` label family carries a different semantic class from the rest of the event vocabulary

Evaluation:

- Structural gain: moderate. A bounded classification or compatibility-backed rename could make the scheduler-to-worker command seam read more truthfully.
- Semantic risk: medium to high. This seam is tied to evented execution, replay, checkpointing, event-store history, older tests, and existing operational reasoning around `task.ready`.
- Scope tightness: only moderate. Even a careful pass would touch scheduler publishing, worker subscription/parsing, tests, docs, and likely compatibility logic for stored/runtime observers.
- True protocol/boundary cleanup: yes, but only at the runtime-internal boundary.
- Drift risk: high. This is the point where RF-036 starts leaning into execution/replay/event-store semantics rather than finishing another clean transport-boundary cleanup.

Judgment:

This is the only remaining RF-036 target with real structural substance, but it is no longer a low-risk continuation of Session 116.

### Candidate B: remaining gateway/runtime event typing mismatch after Session 116

Current code evidence:

- `src/gateway/types.ts` now cleanly splits live and compatibility event typing
- `src/gateway/public.ts` exports live types only
- `src/gateway/compatibility.ts` exports compatibility-only task-event types/helpers
- `src/gateway/events/broadcast-manager.ts` broadcasts only live `GatewayEventType` values
- repository search shows `task.narration` / `task.result` now live only in the compatibility exports and TUI compatibility handler

Evaluation:

- Structural gain: low. The meaningful mismatch that existed in Session 115 appears already resolved.
- Semantic risk: low.
- Scope tightness: high.
- True protocol/boundary cleanup: no longer enough left to justify a session.
- Drift risk: low, but the likely work would now be cosmetic rather than architectural.

Judgment:

No high-value remaining gateway typing mismatch was found.

### Candidate C: another producer/consumer seam still carrying live protocol ambiguity

Current code evidence:

- `SchedulerEventAdapter` republishes scheduler events as normalized `workitem.*`, `run.*`, `verification.*`, and budget events
- `GatewayEventAdapter` forwards a limited live gateway subset back onto the runtime bus using the same normalized names
- `BroadcastManager` continues to broadcast only the live gateway families
- the only remaining `task.*` producer/consumer seam in live code is `task.ready`

Evaluation:

- Structural gain: low to moderate.
- Semantic risk: medium if pursued broadly, because the next steps would drift into runtime event-bus taxonomy or replay/audit meaning.
- Scope tightness: low. There is no second concentrated ambiguity seam comparable to Session 116's gateway compatibility residue.
- True protocol/boundary cleanup: mostly no at this point; the remaining work would tend toward taxonomy polish or deeper runtime redesign.
- Drift risk: high.

Judgment:

No second tightly bounded producer/consumer ambiguity seam remains after Session 116.

## Conclusion

RF-036 should pause now.

Session 116 already captured the one clearly high-value, tightly bounded, semantics-preserving event-protocol cleanup that was still available: separating legacy gateway/TUI `task.narration` / `task.result` compatibility residue from the authoritative live gateway protocol.

After that cleanup, the codebase does not show another equally bounded follow-up inside RF-036. The only substantial remaining candidate is the runtime-internal `task.ready` seam, and that candidate is materially more entangled with:

- evented execution dispatch ownership
- replay/checkpoint reasoning
- event-store history and audit meaning
- worker-side duplicate suppression and operational expectations

That makes the next RF-036 step a poorer risk/reward trade than Session 116. Pushing immediately would likely be stretching the line rather than finishing another clean boundary cleanup.

## Practical Re-Ranking

With RF-036 paused, the remaining live project candidates should rank roughly as follows:

1. Start a fresh major-block review to identify the next genuinely high-yield architecture target, instead of forcing another protocol rename/classification pass.
2. Keep RF-036 paused unless a future session can justify a very narrow `task.ready` compatibility-backed migration with explicit replay/event-store constraints.
3. Keep previously paused or low-yield lines paused:
   - `RF-030` already hit diminishing returns in Session 114
   - source-of-truth and singleton lines were already paused after their own review stages
   - tool-mode and deeper tool hardening remain weaker candidates unless topology goals change

The key point is that RF-036 no longer has a clearly better next slice than the broader field.

## What Should Not Be Done Next

- Do not do a repo-wide rename of `task.ready` to a new execution-command label without a dedicated migration plan.
- Do not widen RF-036 into runtime event-store schema cleanup, replay semantics, or audit terminology redesign.
- Do not treat remaining compatibility exports in `src/gateway/compatibility.ts` as a problem just because they still exist; their explicit existence is the boundary cleanup win from Session 116.
- Do not reopen gateway/daemon transport, startup/bootstrap, or GatewayServer wiring lines under the banner of event-protocol cleanup.
- Do not spend a session on cosmetic event-type renaming where current producers and consumers are already structurally clear.

## Recommended Session 118

Recommend Session 118 as a new bounded review/design session to re-rank the broader remaining project candidates and select the single strongest next major block, rather than continuing RF-036 immediately.

That is the highest-signal next move because RF-036 now appears to be at diminishing returns, and the remaining live candidate inside the line is no longer clearly safer or more valuable than stepping back and choosing the next block deliberately.

## Validation

Validation for this session was documentation/review-only:

- reviewed current Session 115 and Session 116 refactor docs
- searched the current repository for live `task.ready`, `task.narration`, and `task.result` producers/consumers
- inspected the current gateway typing, compatibility exports, TUI event routing, scheduler publish path, execution worker subscribe path, and runtime event adapters
- made no runtime code changes

## Files Changed

- `docs/refactoring/session117-rf036-line-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`
