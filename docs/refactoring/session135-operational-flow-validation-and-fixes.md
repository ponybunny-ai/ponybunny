# Session 135: Operational Flow Validation and First Runtime Findings

## Chosen Flow

Chosen flow: one real `goal.submit` flow.

Why this flow was chosen:

- it is the narrowest live end-to-end path already exposed by the runnable system
- it exercises real gateway RPC submission, daemon IPC handoff, scheduler execution, and result/reporting surfaces
- it avoids reopening paused `agent.command.submit` / agent-tick architecture lines unless the runtime evidence requires that later

## Validation Run

### Build / typecheck

- `npx tsc --noEmit --pretty false`
- `npm run build`

### Narrow tests for the chosen flow

- `npx jest test/gateway/rpc/goal-handlers.test.ts test/gateway/rpc/workitem-handlers.test.ts test/gateway/integration/ipc-bridge.test.ts --runInBand`

### Live startup attempts

Isolated runtime root:

- `HOME=/tmp/pony-session135.VFmorY`

Database / runtime paths:

- main DB: `/tmp/pony-session135.VFmorY/pony.db`
- memory DB: `/tmp/pony-session135.VFmorY/memory.db`
- gateway socket: `/tmp/pony-session135.VFmorY/.ponybunny/gateway.sock`

Gateway startup command:

- `env HOME=/tmp/pony-session135.VFmorY node dist/cli/index.js gateway start --foreground -p 18890 -d /tmp/pony-session135.VFmorY/pony.db --memory-db /tmp/pony-session135.VFmorY/memory.db`

Scheduler startup command:

- `env HOME=/tmp/pony-session135.VFmorY node dist/cli/index.js scheduler start --foreground --db /tmp/pony-session135.VFmorY/pony.db --memory-db /tmp/pony-session135.VFmorY/memory.db --socket /tmp/pony-session135.VFmorY/.ponybunny/gateway.sock --agents --main-agent lead`

Pairing token command used for the live client:

- `env HOME=/tmp/pony-session135.VFmorY node dist/cli/index.js gateway pair -d /tmp/pony-session135.VFmorY/pony.db -p read,write,admin -e 1`

### Live end-to-end operational attempt

Operational harness command:

- `env HOME=/tmp/pony-session135.VFmorY PB_TOKEN=<pairing-token> node --input-type=module -`

Harness behavior:

- connect to `ws://127.0.0.1:18890` using `GatewayClient`
- authenticate with the admin pairing token through `auth.token`
- submit one real `goal.submit`
- poll `goal.status`
- query `workitem.byGoal`
- query `workitem.runs`
- capture streamed `goal.*` / `workitem.*` events

Observed live flow:

- `goal.submit` returned goal `63b8849a-3e9e-4bcd-b783-62446189739f`
- `workitem.started` fired for work item `209eaa14-b74c-4ef1-a076-432338b04789`
- `workitem.in_progress` fired for execution and later verification
- `workitem.completed` fired
- `goal.completed` fired
- `goal.status` reached `completed` on poll attempt 5
- `workitem.byGoal` returned one work item with status `done`
- `workitem.runs` returned two success runs for that one work item

## Blocker Classification

### Startup already solved

- gateway foreground startup succeeded on the isolated runtime path
- scheduler foreground startup succeeded on the isolated runtime path
- gateway and scheduler connected successfully over the isolated IPC socket

### Request / command submission blockers

- none on the chosen path

Evidence:

- authenticated client connection succeeded
- `goal.submit` acknowledged immediately
- `goal.created` event emitted

### Runtime execution blockers

- none on the chosen path

Evidence:

- scheduler created and started the work item
- live execution completed successfully under the mock-provider fallback runtime
- work item reached `done`

### Result / reporting blockers

- no blocking result/reporting failure on the chosen path

Result/reporting evidence that succeeded:

- `goal.completed` event emitted
- `goal.status` returned `completed`
- `workitem.byGoal` and `workitem.runs` both returned coherent terminal data for the goal/work item

Non-blocking reporting residue found:

- `workitem.runs` returned two success runs for the single successful work item:
  - run sequence 1: scheduler-owned run `dbc8d0f2-0baa-4241-a9a3-f0252928db4c`
  - run sequence 2: internal execution-service run `3c3291f9-8ebc-4ca6-94de-deda4c4f096a`
- the first run carried the scheduler-facing lifecycle and terminal status
- the second run carried the execution log / detailed mock-output payload
- this did not block completion of the real `goal.submit` flow, but it is noisy operator/reporting residue on the direct local execution path
- the active code already acknowledges this residue in `src/runtime/execution-boundary/local-execution-adapter.ts` with the existing duplicate-run TODO; broadening into run-lifecycle redesign would have exceeded this session's scope

### Non-blocking environment warnings

- the sandbox still blocked loopback port bind/connect with `listen EPERM` / `connect EPERM`; rerunning the same isolated commands outside the sandbox succeeded, so this was an execution-environment restriction rather than a PonyBunny runtime failure
- the isolated runtime had no `llm-config.json` or API keys, so the scheduler used the existing mock-provider fallback path; that was sufficient for this validation and did not block the chosen flow

## Fixes Applied

No source-code fix was required to make the chosen flow work.

Applied changes in this session were limited to:

- runtime validation
- session documentation
- master task list update

Reason no runtime code was changed:

- the selected real `goal.submit` flow already worked end to end on the live isolated system
- the only issue exposed by real runtime evidence was non-blocking duplicate direct-run persistence/reporting residue, not a blocker for operational correctness on this path

## Remaining Blocked vs Non-Blocking

Blocked:

- none on the validated `goal.submit` operational path

Non-blocking:

- duplicate local run persistence/reporting residue on the direct execution path for a single successful work item
- sandbox loopback bind/connect restrictions during local validation
- isolated-runtime mock-provider fallback due missing credentials/config

## Operational-State Assessment

Assessment: fully working, with non-blocking warnings.

What is proven by this session:

- the post-Session-134 runnable system is not just startup-clean; one real operational `goal.submit` path now has live evidence from request submission through execution and terminal reporting
- gateway RPC submission works
- gateway-to-daemon IPC materialization/submission works
- scheduler execution works on the isolated runtime path
- goal/work-item terminal reporting works on that path

## Follow-Up Based On Runtime Evidence

Next session should remain runtime-driven.

Best next focus:

- validate one real `agent.command.submit` path end to end on the same isolated live harness style

Important scope guidance for that next step:

- do not reopen paused architecture lines just because the direct path exposed duplicate local run residue
- only treat the duplicate-run issue as an active fix target if it blocks operator-facing run inspection or the next chosen operational path
