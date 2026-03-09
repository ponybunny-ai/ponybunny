# Session 21: Manual Recovery Action Design

This session is documentation-only.

It defines the safe manual action model for evented execution runs that have already been marked as recovery candidates.

It does not implement recovery behavior.
It does not change gateway behavior, IPC, direct vs evented execution semantics, tool worker behavior, or conversation worker behavior.
It does not add replay, retry, reattachment, or force-terminalization.

## Current durable baseline

After Sessions 17 through 20B, the system has four relevant durable signals on or around the run:

- `runs.context.evented_dispatch` indicates that scheduler-owned evented dispatch happened
- `runs.context.evented_dispatch.result_continuation_applied` indicates whether the scheduler-side continuation has already been durably claimed and consumed
- `runs.context.evented_dispatch.orphan_classification` indicates that reconciliation classified the run as stale/orphaned
- `runs.context.evented_dispatch.recovery_candidate` indicates explicit operator intent to hold the run for future manual recovery handling

Those signals support inspection and conservative marking.
They do not yet support safe re-execution, safe requeueing, safe resumption, safe terminal override, or safe suppression of future late-arriving execution results.

## Design objective

The next manual recovery action model must be narrower than "recover the run."

The system can currently identify suspicious evented runs and mark them for operator attention, but it still lacks the invariants required to prove that a manual execution-side action would not duplicate work, race a late result, or corrupt run/work item/goal state.

So the near-term design should separate actions into three categories:

1. safe metadata actions that only express operator intent
2. guarded state-transition actions that may become safe after additional hardening
3. execution-affecting actions that remain premature until replay/retry invariants exist

## Candidate manual actions

### 1. Clear / unmark recovery candidate

Purpose:
Remove the operator-intent marker when inspection shows the run should no longer be held for manual recovery follow-up.

Preconditions:
- run has a valid `evented_dispatch` checkpoint
- `recovery_candidate = true`
- action is operator-initiated and audited

Durable state checks required:
- read current `evented_dispatch`
- confirm the run still exists
- confirm the marker is currently set
- do not require `runs.status = "running"` if the goal is to clear stale operator metadata conservatively

Whether it mutates run/work item/goal state:
- mutates only recovery metadata in `runs.context.evented_dispatch`
- does not mutate work item state
- does not mutate goal state
- does not mutate `result_continuation_applied`
- does not mutate `orphan_classification`

Main duplication risks:
- effectively none, because it does not dispatch or continue work

Main correctness risks:
- an operator could clear the marker too early and lose a visible reminder
- if implemented as destructive deletion of all recovery metadata instead of a narrow flag clear, audit history could be lost

Should it be allowed before full recovery hardening is complete:
- yes

Assessment:
This is the safest next action because it is metadata-only and reversible in meaning, while preserving current runtime semantics.

### 2. Mark as replay candidate

Purpose:
Record a more specific operator intent that this run might later be eligible for replay-based recovery, distinct from the broader `recovery_candidate` marker.

Preconditions:
- run already marked as `recovery_candidate = true`
- run remains within evented execution scope

Durable state checks required:
- valid `evented_dispatch`
- current recovery marker present
- ideally `result_continuation_applied = false`, otherwise replay candidacy is misleading

Whether it mutates run/work item/goal state:
- metadata-only if implemented narrowly
- no run/work item/goal mutations required

Main duplication risks:
- none directly if it is metadata-only
- indirect risk: operators may over-read the label as approval to replay before replay is actually safe

Main correctness risks:
- introduces a second intent label before replay safety exists
- can create policy confusion between "candidate for future analysis" and "approved for safe replay"

Should it be allowed before full recovery hardening is complete:
- not yet recommended

Assessment:
This could exist later, but it adds taxonomy before the underlying recovery mechanism is defined. It is not the best next move.

### 3. Safe manual replay

Purpose:
Re-drive execution from an earlier boundary using preserved durable state rather than merely acknowledging the orphaned run.

Preconditions:
- authoritative replay boundary exists
- replay source of truth is complete
- late original results can be rejected or quarantined
- replay can prove idempotent state effects on run/work item/goal

Durable state checks required:
- valid `evented_dispatch`
- `result_continuation_applied = false`
- run still durable `running` or a dedicated replay-pending state exists
- orphan/recovery marker present
- proof that original worker is no longer able to produce authoritative results, or that such results can be suppressed safely

Whether it mutates run/work item/goal state:
- yes, potentially all of them

Main duplication risks:
- duplicate external tool execution
- duplicate model usage
- duplicate side effects
- late original result racing with replay result
- double application of success/failure continuation

Main correctness risks:
- no authoritative replay contract currently exists for evented execution recovery
- current durable checkpoint is not a full execution command log
- the system cannot yet guarantee exactly one authoritative continuation source after replay starts

Should it be allowed before full recovery hardening is complete:
- no

Assessment:
Too risky and premature.

### 4. Safe manual retry

Purpose:
Re-run the work through the existing scheduler-owned retry path after operator intervention.

Preconditions:
- retry semantics are explicitly defined for orphaned evented runs
- retry can safely detach from any prior in-flight execution
- run/work item ownership and attempt accounting are durable

Durable state checks required:
- valid evented checkpoint
- `result_continuation_applied = false`
- run/work item not already terminal
- proof that retry will not race a late original completion
- durable retry-attempt ownership or equivalent guard

Whether it mutates run/work item/goal state:
- yes

Main duplication risks:
- duplicate execution of the same work item
- duplicate downstream side effects
- retry path racing a delayed original evented completion

Main correctness risks:
- current retry path assumes scheduler-owned normal failure continuation, not manual orphan intervention
- no current durable invariant cleanly transfers ownership from the orphaned attempt to a replacement attempt

Should it be allowed before full recovery hardening is complete:
- no

Assessment:
Retry is materially the same risk class as replay in the current architecture.

### 5. Force fail / force terminalize

Purpose:
Allow an operator to stop waiting and manually drive a stuck run into a terminal failed state.

Preconditions:
- explicit policy exists for which durable row owns terminal authority
- late result suppression exists
- work item and goal terminal transitions are proven safe from current state

Durable state checks required:
- valid target run
- not already terminal
- `result_continuation_applied = false`
- proof that a later result cannot resurrect or double-mutate state

Whether it mutates run/work item/goal state:
- yes, directly

Main duplication risks:
- not duplicate execution, but duplicate terminal mutation if a real result later arrives

Main correctness risks:
- a late authoritative result may still appear after the operator force-fails the run
- current system does not yet define a durable "manual terminal override wins" rule
- could conflict with existing scheduler-owned continuation semantics

Should it be allowed before full recovery hardening is complete:
- no

Assessment:
This looks conservative operationally, but it is still unsafe without a durable late-result suppression contract.

### 6. Suppress / ignore future continuation for a run

Purpose:
Prevent any later result event from applying scheduler-side continuation for a specific run once the operator has decided the original attempt must never continue.

Preconditions:
- explicit durable suppression flag exists
- result handler consults that flag before continuation claim
- operator policy for suppressed runs is defined

Durable state checks required:
- valid evented checkpoint
- run identifiable as the original attempt being suppressed
- no already-applied continuation

Whether it mutates run/work item/goal state:
- it may be metadata-only initially, but it changes future continuation behavior and is therefore semantically stronger than simple metadata

Main duplication risks:
- can reduce duplicate continuation risk
- but if suppression is applied incorrectly, it can drop the only valid late result and strand the run permanently

Main correctness risks:
- this is behavior-changing, not merely descriptive
- it implicitly modifies evented execution semantics
- if introduced before replay/retry/terminal policy exists, it can create unrecoverable limbo

Should it be allowed before full recovery hardening is complete:
- no

Assessment:
Potentially useful later, but out of scope and too behaviorally significant for the current hardening level.

### 7. No-op / acknowledge only

Purpose:
Let an operator record that the run was reviewed without changing execution behavior.

Preconditions:
- run is inspectable
- operator wants explicit acknowledgement without clearing the recovery-candidate marker

Durable state checks required:
- target run exists
- if persisted, acknowledgement metadata should be append-only or independently tracked

Whether it mutates run/work item/goal state:
- metadata-only if persisted
- no mutation if implemented as purely procedural/operator convention

Main duplication risks:
- none directly

Main correctness risks:
- if this becomes a second overlapping marker beside `recovery_candidate`, operator semantics may become redundant
- low value unless there is a concrete workflow need for "seen but still pending"

Should it be allowed before full recovery hardening is complete:
- yes in principle, but lower priority than clear/unmark

Assessment:
Safe, but less useful than unmarking because Session 20B already provides a durable operator-intent marker.

## Safe near-term actions

The only clearly safe near-term actions are metadata-only actions that do not affect continuation, dispatch, scheduler retry logic, or terminal state:

- clear / unmark recovery candidate
- no-op / acknowledge only, if a separate acknowledgement concept is later shown to be operationally necessary

Among those, `clear / unmark recovery candidate` is the strongest next action because it closes the operator workflow loop around the marker introduced in Session 20B.

## Unsafe or premature actions

These actions are unsafe or premature at the current hardening level:

- safe manual replay
- safe manual retry
- force fail / force terminalize
- suppress / ignore future continuation for a run

They all either change scheduler semantics, require late-result suppression guarantees, or require durable attempt ownership that does not yet exist.

## Actions that require more hardening first

These actions may become valid later, but only after additional invariants are introduced:

- mark as replay candidate
- safe manual replay
- safe manual retry
- force fail / force terminalize
- suppress / ignore future continuation for a run

## Recommended first manual recovery action

The single safest first manual recovery action to implement next is:

`clear / unmark recovery candidate`

Why this one:

- it is metadata-only
- it does not broaden runtime behavior
- it does not create a second execution authority
- it does not mutate run/work item/goal state
- it gives operators a complete conservative workflow: inspect, mark, later clear if the mark was mistaken or no longer needed
- it preserves the current architectural boundary that recovery remains future work

## Interaction with existing durable fields

### `evented_dispatch` checkpoint

The recommended action should operate only within the existing `runs.context.evented_dispatch` object.
It should not create a new top-level recovery table or a new execution state machine.

### `result_continuation_applied`

`clear / unmark recovery candidate` should not read as permission to re-open continuation.
If `result_continuation_applied = true`, clearing the recovery marker only removes operator intent metadata.
It must not alter the durable idempotency guard or reinterpret the run as pending execution again.

### `orphan_classification`

`orphan_classification` reflects scheduler reconciliation classification, not operator intent.
Clearing `recovery_candidate` should not erase or rewrite orphan classification.
The run may remain durably classified as `stale_timeout` even after the operator removes the manual-recovery marker.

### `recovery_candidate` marker

The clear/unmark action should target only the recovery marker fields.
A conservative shape is:

- set `recovery_candidate = false`
- set `recovery_candidate_cleared_at = <timestamp>` only if an audit field is later deemed necessary
- preserve original mark timestamps/reason if audit retention is required, or explicitly replace them with a new clear reason if a narrow audit model is preferred

The key rule is that clearing the marker must remain descriptive, not behavioral.

## What operators can do today

- inspect durable evented in-flight and orphaned runs
- inspect one run in detail
- see `evented_dispatch`, `result_continuation_applied`, `orphan_classification`, and recovery-candidate metadata
- mark a run as a recovery candidate for later follow-up

## What operators still cannot safely do

- replay a run
- retry a run
- resume or reattach the original execution
- force result continuation to apply
- force fail or otherwise terminalize a still-running evented run
- suppress a future late result
- move work items or goals into replacement states for recovery purposes

## Minimum additional invariants required before manual replay or manual retry can be considered safe

At minimum, manual replay or manual retry needs all of the following:

1. A single authoritative ownership rule for which attempt is allowed to produce the next valid continuation.
2. A durable way to quarantine or suppress late results from the original attempt once a replacement attempt exists.
3. Durable attempt identity beyond the current coarse `runId` checkpoint so the system can distinguish original vs replacement execution.
4. A proven rule for how run status, work item status, and goal status transition when the original attempt is abandoned and a new attempt starts.
5. Strong idempotency around all scheduler-owned side effects, not only the current continuation-claim bit.
6. A clear operator-visible audit trail showing who initiated replay/retry and which durable attempt became authoritative.
7. A rule for external/tool side effects, or a strict declaration that replay/retry is forbidden when those side effects cannot be proven safe.

Without those invariants, replay and retry remain execution duplication hazards rather than recovery tools.

## Ordered roadmap for manual recovery evolution

1. Step 1: conservative metadata action
   Implement `clear / unmark recovery candidate` as the first reversible metadata-only operator action.
2. Step 2: guarded metadata refinement
   If needed, add acknowledgement or typed candidate metadata only after operator workflow proves it is necessary.
3. Step 3: durable suppression model design
   Define how late results are rejected or quarantined without changing current execution semantics prematurely.
4. Step 4: replacement-attempt ownership design
   Define authoritative attempt identity, retry/replay eligibility, and transition rules between original and replacement execution.
5. Step 5: guarded replay/retry candidate state
   Introduce replay/retry candidate markings only once those actions have real safety gates behind them.
6. Step 6: manual replay or retry implementation
   Implement one execution-affecting action only after the prior invariants exist and are validated end to end.

## Practical recommendation for the next coding session

The next coding session should remain narrow and implement only:

- a manual `clear / unmark recovery candidate` command
- the minimal repository mutation needed to clear the marker safely
- inspect/CLI output updates if needed to show cleared vs active marker state

That session should stay metadata-only and should not yet introduce replay, retry, terminal override, or future-result suppression.

## Validation of scope

This document intentionally does not propose:

- gateway changes
- IPC changes
- direct vs evented execution semantic changes
- tool worker or conversation worker scope
- implementation of replay, retry, reattachment, or force-terminalization

It defines the action model only and recommends the narrowest safe next implementation step.
