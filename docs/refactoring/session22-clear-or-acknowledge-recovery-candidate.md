# Session 22: Clear Recovery Candidate

This session implements the safest first manual recovery action for evented execution:

- `pb scheduler clear-recovery-candidate <runId>`

The action is intentionally narrow and conservative.
It does not implement replay, retry, worker reattachment, force-terminalization, or automatic recovery.
It does not change gateway behavior, IPC, or direct vs evented execution semantics.

## What the new action does

The command lets an operator clear a previously set manual recovery-candidate marker on one run.

It is valid only for runs with an existing durable `runs.context.evented_dispatch` checkpoint.
If the run is not evented or has no valid checkpoint, the command fails without mutating state.

The command is idempotent:

- first successful clear changes the marker from `true` to `false`
- repeated clear calls report that the marker is already cleared
- repeated calls do not create duplicate side effects

## Durable fields mutated

The action mutates only:

- `runs.context.evented_dispatch.recovery_candidate`

Specifically, it writes:

- `recovery_candidate = false`

The implementation intentionally preserves the existing mark metadata:

- `runs.context.evented_dispatch.recovery_candidate_marked_at`
- `runs.context.evented_dispatch.recovery_candidate_reason`

That keeps the durable checkpoint useful for operator audit context without introducing a broader acknowledgement state model in this session.

## What the action does not do

This command does not:

- replay execution
- retry execution
- reattach a worker
- mutate work item state
- mutate goal state
- mutate `runs.status`
- mutate `result_continuation_applied`
- mutate `orphan_classification`
- trigger scheduler continuation
- change direct-mode behavior

It remains a metadata-only operator action.

## Operator usage

Use this command after inspecting a run and deciding the recovery-candidate marker should no longer remain set:

```bash
pb scheduler inspect-run <runId>
pb scheduler clear-recovery-candidate <runId>
```

After clearing, `inspect-run` shows:

- `recoveryCandidate: false`
- the original `recoveryCandidateMarkedAt` timestamp if one existed
- the original `recoveryCandidateReason` if one existed

This means the run was previously marked, but is no longer currently held as an active recovery candidate.

## Why this is the first safe manual action

Session 21 concluded that `clear / unmark recovery candidate` is the safest first manual recovery action because it:

- is metadata-only
- does not alter execution authority
- does not create a second continuation path
- does not broaden scheduler semantics

This session follows that recommendation directly.

## What still remains before real manual recovery can exist

The system still lacks the hardening required for real recovery actions such as replay or retry.
Before those can exist safely, the architecture still needs explicit answers for:

- authoritative replay boundaries
- late-result suppression or quarantine
- durable attempt ownership transfer
- safe manual terminal override policy
- proof that replacement execution cannot double-apply continuation or side effects

Until those invariants exist, manual recovery remains limited to conservative inspection and operator-intent metadata.
