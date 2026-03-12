# Session 136: Agent Command Operational Validation and First Runtime Findings

## Chosen Flow

Chosen flow: one real `agent.command.submit` flow.

Why this flow was chosen:

- Session 135 already proved one real `goal.submit` path end to end.
- `agent.command.submit` is the next live user-facing submission path that materially exercises the post-refactor runtime.
- it reuses the existing runnable gateway/scheduler system without reopening paused architecture lines

## Validation Run

### Build / typecheck

- `npx tsc --noEmit --pretty false`
- `npm run build`

### Narrow tests for the chosen flow

- `npx jest test/gateway/rpc/goal-handlers.test.ts test/gateway/rpc/agent-command-submit-goal-materializer.test.ts test/runtime/execution-boundary/local-execution-adapter.test.ts --runInBand`

### Live startup attempts

Isolated runtime root:

- `HOME=/tmp/pony-session136.HIEMGD`

Database / runtime paths:

- main DB: `/tmp/pony-session136.HIEMGD/pony.db`
- memory DB: `/tmp/pony-session136.HIEMGD/memory.db`
- gateway socket: `/tmp/pony-session136.HIEMGD/.ponybunny/gateway.sock`

Gateway startup command:

- `env HOME=/tmp/pony-session136.HIEMGD node dist/cli/index.js gateway start --foreground -p 18891 -d /tmp/pony-session136.HIEMGD/pony.db --memory-db /tmp/pony-session136.HIEMGD/memory.db`

Scheduler startup command:

- `env HOME=/tmp/pony-session136.HIEMGD node dist/cli/index.js scheduler start --foreground --db /tmp/pony-session136.HIEMGD/pony.db --memory-db /tmp/pony-session136.HIEMGD/memory.db --socket /tmp/pony-session136.HIEMGD/.ponybunny/gateway.sock --agents --main-agent lead`

Pairing token command used for the live client:

- `env HOME=/tmp/pony-session136.HIEMGD node dist/cli/index.js gateway pair -d /tmp/pony-session136.HIEMGD/pony.db -p read,write,admin -e 1`

### Live end-to-end operational attempt

Operational harness command:

- `env HOME=/tmp/pony-session136.HIEMGD PB_TOKEN=<pairing-token> node --input-type=module -`

Harness behavior:

- connect to `ws://127.0.0.1:18891` using `GatewayClient`
- authenticate with the admin pairing token through the real gateway client path
- submit one real `agent.command.submit`
- poll `goal.status`
- query `workitem.byGoal`
- query `workitem.runs`
- capture streamed `goal.*`, `workitem.*`, `run.*`, and `verification.*` events

Observed live flow:

- `agent.command.submit` returned goal `d52e1efe-269b-487f-91dc-8febef26b05c`
- `goal.created` fired for that goal
- `workitem.started` fired for work item `f482fd06-abf0-46e6-87cb-c5c0f706fb41`
- `run.started`, `workitem.in_progress`, `run.completed`, `verification.started`, `verification.completed`, `workitem.completed`, `workitem.ended`, and `goal.completed` all fired
- `goal.status` reached `completed` on poll attempt 7
- `workitem.byGoal` returned one work item with status `done`
- `workitem.runs` returned two success runs for that single work item

## Blocker Classification

### Request validation / command submission blockers

- none on the chosen path

Evidence:

- authenticated client connection succeeded
- `agent.command.submit` acknowledged immediately
- goal creation and later terminal events were emitted

### Gateway materialization blockers

- none on the chosen path

Evidence:

- the gateway-owned `agent-command-submit-goal-materializer` successfully loaded `lead`
- the gateway successfully materialized the goal and `agent_tick` work item through the real daemon path

### Daemon / scheduler handoff blockers

- none on the chosen path

Evidence:

- the isolated scheduler connected to the gateway IPC socket
- the scheduler picked up the submitted goal and started the work item

### Runtime execution blockers

- none on the chosen path

Evidence:

- the submitted work item ran to success
- verification completed
- the goal reached `completed`

### Result / reporting blockers

- no blocking result/reporting failure on the chosen path

Result/reporting evidence that succeeded:

- `goal.completed` fired
- `goal.status` returned `completed`
- `workitem.byGoal` and `workitem.runs` both returned coherent terminal data

### Non-blocking warnings

- the sandbox still blocked loopback bind/connect with `listen EPERM`; rerunning the same isolated commands outside the sandbox succeeded, so this was an execution-environment restriction rather than a PonyBunny runtime failure
- the isolated runtime had no `llm-config.json` or API keys, so the scheduler used the existing mock-provider fallback path; that was sufficient for this validation and did not block the chosen flow
- `workitem.runs` again returned two success runs for the single successful work item, matching the non-blocking duplicate direct-run persistence/reporting residue already observed in Session 135
- the gateway log showed `goal.started` broadcast to `0` subscribers before the creator subscription existed, while the client still received `goal.created` and all later terminal events; this is non-blocking event-ordering residue on the auto-submitted path, not a terminal-flow blocker

## Fixes Applied

No source-code fix was required to make the chosen flow work.

Applied changes in this session were limited to:

- targeted validation
- live runtime startup and authenticated operational verification
- session documentation
- master task list update

Reason no runtime code was changed:

- the selected real `agent.command.submit` flow already worked end to end on the live isolated system
- the issues exposed by runtime evidence were non-blocking warnings rather than blockers to operational correctness on this path

## Remaining Blocked vs Non-Blocking

Blocked:

- none on the validated `agent.command.submit` path

Non-blocking:

- duplicate direct-run persistence/reporting residue on the direct local execution path
- early `goal.started` broadcast arriving before creator subscription on auto-submitted flows
- sandbox loopback bind/connect restrictions during local validation
- isolated-runtime mock-provider fallback due missing credentials/config

## Operational-State Assessment

Assessment: fully working, with non-blocking warnings.

What is proven by this session:

- the post-Session-135 runnable system supports one real end-to-end `agent.command.submit` flow
- authenticated gateway RPC submission works
- gateway-to-daemon goal materialization works
- daemon/scheduler handoff works
- work-item execution and verification complete successfully
- terminal goal/work-item/run reporting works on this path

## Follow-Up Based On Runtime Evidence

Next session should remain runtime-driven.

Best next focus:

- validate one more real operational flow on the live runnable system

Scope guidance from this session:

- do not reopen paused architecture lines just because `agent.command.submit` still shows the same non-blocking duplicate run-reporting residue seen on `goal.submit`
- only treat early `goal.started` event visibility or duplicate direct-run reporting as active fix targets if a later operational path shows that they block real operator behavior
