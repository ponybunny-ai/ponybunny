# Session 121: RF-036 `task.ready` Follow-Up Review

## Scope

Session 121 is a bounded design/review follow-up for `RF-036`.

This session is documentation only. It does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused source-of-truth, singleton, detach, `RF-062`, `RF-030`, `RF-071`, or broader topology lines by default
- redesign scheduler semantics
- redesign execution-worker behavior
- redesign replay, checkpoint, event-store, or audit semantics
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport behavior
- change provider execution/fallback behavior
- change existing RPC/event/status payload shapes
- change TUI behavior

## Files Reviewed

Primary current-code review targets:

- `src/scheduler/core/scheduler.ts`
- `src/runtime/workers/execution-worker.ts`
- `src/runtime/execution-boundary/types.ts`
- `src/runtime/event-bus/runtime-event.ts`
- `src/runtime/event-bus/runtime-event-store.ts`
- `src/runtime/event-bus/adapters/scheduler-event-adapter.ts`
- `src/scheduler/evented-dispatch-checkpoint.ts`
- `src/cli/commands/events.ts`

Targeted validation/tests reviewed for current coupling:

- `test/scheduler/core/scheduler.test.ts`
- `test/runtime/workers/execution-worker.test.ts`
- `test/gateway/integration/scheduler-factory.test.ts`

Prior session outputs reviewed:

- `docs/refactoring/session115-rf036-event-protocol-review.md`
- `docs/refactoring/session116-rf036-gateway-compatibility-boundary.md`
- `docs/refactoring/session117-rf036-line-review.md`
- `docs/refactoring/session120-rf071-line-review.md`

## Current Runtime-Internal `task.ready` Path

### Producer

`SchedulerCore.publishTaskReady(...)` in `src/scheduler/core/scheduler.ts` is the only live producer.

In evented mode it:

1. builds the normalized `ExecutionRequest`
2. writes/merges `runs.context.evented_dispatch` with `execution_mode: 'evented'`, `lane_id`, `dispatched_at`, and `result_continuation_applied: false`
3. publishes runtime event `type: 'task.ready'` with scheduler-owned identity fields plus `payload: request`

### Consumer

`LocalExecutionWorker.start()` in `src/runtime/workers/execution-worker.ts` is the only live consumer.

It subscribes directly to `task.ready`, parses `event.payload` as an `ExecutionRequest`, suppresses duplicate `runId`s in memory for the current worker lifetime, executes the request through `ExecutionPort`, and then publishes `execution.started`, `execution.completed`, or `execution.failed`.

### Payload and meaning

The payload is not a loose progress notification. It is the actual normalized `ExecutionRequest` defined in `src/runtime/execution-boundary/types.ts`:

- `runId`
- `goalId`
- `workItemId`
- `workItem`
- `model`
- `laneId`
- `budgetRemaining`

Current meaning:

- `task.ready` means the scheduler has durably dispatched one run for evented execution and is handing the worker the authoritative execution request.
- It is an imperative scheduler-to-worker command seam, even though the event name still uses the older `task.*` vocabulary.

### Authoritative protocol or compatibility residue?

It is currently authoritative internal protocol with legacy vocabulary, not mere compatibility residue.

Why:

- the scheduler writes durable `evented_dispatch` state immediately before publishing it
- the worker treats it as the real execution trigger, not as an optional alias
- replay/manual replay uses the same publication path for replacement runs
- current tests assert this event directly
- runtime event storage persists the event type verbatim as part of the operational history

### Systems that currently depend on its meaning

- Evented dispatch checkpointing:
  `src/scheduler/core/scheduler.ts` and `src/scheduler/evented-dispatch-checkpoint.ts`
- Worker dispatch and local duplicate suppression:
  `src/runtime/workers/execution-worker.ts`
- Evented completion/failure continuation claim:
  `SchedulerCore` consumes `execution.completed` / `execution.failed` as the authoritative follow-on to the same dispatch checkpoint
- Replay/manual replay:
  replacement runs are re-dispatched through the existing `task.ready` path in scheduler tests
- Runtime event history / inspection:
  `src/runtime/event-bus/runtime-event-store.ts` persists the type as-is and `src/cli/commands/events.ts` tails stored runtime events generically
- Regression coverage / operational expectations:
  `test/scheduler/core/scheduler.test.ts`, `test/runtime/workers/execution-worker.test.ts`, and `test/gateway/integration/scheduler-factory.test.ts`

Notably, no current public gateway/TUI transport path depends on `task.ready`. Its dependencies are internal evented-execution machinery and runtime-event history.

## Issue Classification

### 1. Naming drift

`task.ready` no longer matches the surrounding live vocabulary.

- runtime observation events are mostly `workitem.*`, `run.*`, `verification.*`, and budget events
- worker result events are `execution.*`
- the dispatch command still uses the older `task.*` prefix

### 2. Authoritative internal protocol with legacy vocabulary

This seam is not dead compatibility surface. It is the live internal dispatch contract, but it carries a legacy-looking name.

### 3. Type/meaning mismatch

Meaning is stricter than the generic runtime event typing suggests.

- `RuntimeEvent.type` is just `string`
- `RuntimeEvent.payload` is `unknown`
- the worker has a local `TaskReadyEventPayload = ExecutionRequest` alias, but scheduler and worker do not share a single explicit command contract object/type for this event

### 4. Producer/consumer coupling

Scheduler and worker are tightly coupled on:

- event type string: `task.ready`
- payload meaning: full `ExecutionRequest`
- follow-on semantics: `execution.started` / `execution.completed` / `execution.failed`

That coupling is intentional today, but it means any rename or alias migration reaches both sides immediately.

### 5. Historical compatibility residue around terminology, not around ownership

The residue is mainly the name itself. The seam no longer looks like a stale public compatibility boundary in the way gateway `task.narration` / `task.result` did.

## Plausible Next Slices

Only slices supported by the current codebase are included here.

### Slice A: explicit authoritative-internal classification without renaming

What it would mean:

- make the code treat `task.ready` explicitly as the authoritative internal execution-dispatch command
- tighten nearby comments/docs and, if coded later, possibly centralize the contract shape without changing the emitted type string

Evaluation:

- Structural gain: low to moderate
- Semantic risk: low
- Scope tightness: high
- True protocol/boundary cleanup: weak to moderate
- Drift risk: low

Judgment:

This is safe, but it is mostly classification/documentation. It does not materially reduce coupling or normalize the protocol boundary by itself.

### Slice B: tightened typing around the existing semantics

What it would mean:

- introduce one shared internal `task.ready` contract type/guard/helper so scheduler and worker stop carrying the contract implicitly in separate places
- preserve the event name and payload shape

Evaluation:

- Structural gain: low
- Semantic risk: low
- Scope tightness: high
- True protocol/boundary cleanup: weak
- Drift risk: low

Judgment:

This is the safest coding slice, but it is mostly type/contract polish. It does not solve the naming drift in a meaningful way and does not change the actual protocol boundary.

### Slice C: a narrow internal compatibility alias

What it would mean:

- introduce a more explicit execution-dispatch event name while keeping `task.ready` compatibility during migration
- likely require scheduler publication and worker subscription changes together

Evaluation:

- Structural gain: moderate
- Semantic risk: medium to high
- Scope tightness: only moderate
- True protocol/boundary cleanup: yes
- Drift risk: high

Why the risk is real in current code:

- runtime event history would now contain multiple names for one command seam, or would lose the old name
- replay/manual replay tests and operational reasoning currently assume one `task.ready` path
- any dual-publish approach risks polluting the runtime event store with duplicate command history rather than clarifying it

Judgment:

This is the smallest slice that would count as real protocol normalization, but it is not tightly bounded enough relative to its gain.

### Slice D: bounded rename with compatibility backing

What it would mean:

- rename the authoritative command seam away from `task.ready`
- preserve compatibility through fallback publication/subscription or migration logic

Evaluation:

- Structural gain: moderate
- Semantic risk: high
- Scope tightness: weak
- True protocol/boundary cleanup: yes
- Drift risk: high

Judgment:

This is not the right next move. It drifts directly into runtime event taxonomy migration, replay/event-store history questions, and worker/scheduler transition mechanics for limited structural payoff.

## Conclusion

### Answer to the primary question

No. The runtime-internal `task.ready` seam does not currently have one safe, tightly bounded, compatibility-backed normalization slice worth doing now.

The reason is not that the seam is fake. It is real and still architecturally visible. The problem is that the remaining plausible moves split into two weak groups:

- safe but low-yield moves:
  authoritative classification or shared typing/documentation around the existing `task.ready` meaning
- meaningful but not tightly bounded moves:
  aliasing or renaming the live command seam

That means there is no remaining slice that is both:

- strong enough to count as real `RF-036` protocol cleanup
- and safe/tight enough to justify resuming the line now

### Recommendation

`RF-036` should remain fully paused.

Current `task.ready` is best understood as:

- authoritative internal execution-dispatch protocol
- carrying legacy vocabulary
- but already embedded in evented dispatch, replay/manual replay, runtime-event history, and worker coupling deeply enough that the next normalization step would spend real semantic-risk budget

The codebase no longer shows a high-value middle ground between harmless polish and riskier protocol migration.

## Practical Re-Ranking

If `RF-036` stays paused, the broader remaining candidates rank roughly as follows:

1. Run a new major-block re-ranking review to choose the next active line deliberately, instead of forcing another low-yield `RF-036` session.
2. Keep `RF-030` as the cleanest already-known secondary paused line if a concrete new sub-slice emerges.
3. Keep `RF-024` and `RF-026` low unless tool topology goals materially change.
4. Keep broader source-of-truth, singleton, detach/unsubscribe, and topology-dependent follow-ups paused unless a new concentrated seam is identified.

The important point is that `RF-036` no longer beats the broader field on risk/reward.

## What Should Not Be Done Next

- Do not do a naming-only rename of `task.ready`.
- Do not dual-publish a new execution-dispatch event plus `task.ready` just to claim protocol cleanup.
- Do not widen this line into runtime event-store taxonomy redesign, replay semantics, checkpoint schema work, or audit/history reinterpretation.
- Do not treat shared typing/comment extraction alone as if it meaningfully reopens `RF-036`.
- Do not reopen scheduler semantics, worker behavior, startup/bootstrap wiring, or gateway/daemon transport lines under the banner of event protocol cleanup.

## Recommended Session 122

Recommend exactly one next session:

Session 122 should be a bounded major-block re-ranking review that selects the single strongest remaining project candidate after the Session 121 confirmation that `RF-036` should remain paused.

That is the highest-signal next move because this follow-up found no remaining `task.ready` slice that is both meaningful enough and safe enough to justify another RF-036 coding/design session.

## Validation

Validation for this session was review-only:

- inspected the live `task.ready` producer in `src/scheduler/core/scheduler.ts`
- inspected the live `task.ready` consumer in `src/runtime/workers/execution-worker.ts`
- inspected adjacent `ExecutionRequest`, runtime-event typing, runtime-event storage, scheduler event adapter, CLI runtime-event inspection, and `evented_dispatch` checkpoint code
- inspected current tests that assert `task.ready` behavior and replay/manual replay dependence
- made no runtime code changes

## Files Changed

- `docs/refactoring/session121-rf036-task-ready-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`
