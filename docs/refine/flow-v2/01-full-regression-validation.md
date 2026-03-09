# Flow-v2 Full Regression Validation Report

## 1. Goal and method

This report validates the newly implemented to-be system using the same step method from `docs/refine/flow` (`step-01` to `step-10`), with two evidence classes:

1. Static analysis (code-path/constraint/LSP checks)
2. Simulated runtime regression (tests/build/script simulation)

Validation target is the completed execution mainline in `docs/refine/to-be/10-execution-mainline.md`.

## 2. Validation checklist baseline (from flow)

Execution followed the flow checklist extracted from:

- `docs/refine/flow/README.md`
- `docs/refine/flow/step-01-init.md` ... `docs/refine/flow/step-10-scenario-simulation-result.md`

Key flow risks used as regression anchors:

1. session-first to daemon submit chain not closed
2. queued recovery is one-shot at daemon startup
3. session-first goal may complete directly with no work items
4. event visibility depends on goal subscription path
5. TUI input mode semantics drift (`goalSubmitFastPathEnabled` vs session-first UX)

## 3. Static analysis results

### 3.1 Role-boundary and materialization path

- Gateway RPC handlers no longer directly call `createGoal`/`createWorkItem` (AST check on `src/gateway/rpc/handlers` returned no matches).
- Conversation runtime path is IPC session-first forwarding:
  - `src/gateway/rpc/handlers/conversation-handlers.ts` uses `ipcBridge.sendSessionMessage(...)`.
- Scheduler daemon now supports scheduler-side materialization command:
  - `src/scheduler-daemon/daemon.ts` handles `materialize_goal`, with `goalSpec`, optional `initialWorkItemSpec`, and `autoSubmitGoal`.

### 3.2 Session visibility and routing correctness

- `gatewaySessionId` mapping and scoped delivery path is implemented in `src/gateway/integration/ipc-bridge.ts`.
- Session-scoped event routing behavior is covered in `test/gateway/events/broadcast-manager.test.ts`.

### 3.3 Realtime telemetry and replay cursor

- ACK/stream P95 telemetry surfaces exist in:
  - `src/gateway/integration/ipc-bridge.ts`
  - `src/gateway/rpc/handlers/system-handlers.ts`
- Channel replay cursor paging exists in:
  - `src/gateway/rpc/handlers/system-handlers.ts` (`cursor`, `nextCursor`)

### 3.4 Adapter policy/fanout and control-plane signal

- Adapter config impact summary is emitted in:
  - `src/gateway/gateway-server.ts` (`channel.adapter.config.updated` with `impactSummary`)
- Delivery fanout path exists and is policy-aware via:
  - `src/gateway/gateway-server.ts`
  - `src/gateway/channels/channel-adapter-manager.ts`
  - `src/gateway/channels/channel-adapter.ts` (Discord webhook publish path)

### 3.5 TUI consistency check

- UI mode label/help is session-first only in:
  - `src/cli/tui/components/layout/main-layout.tsx`
  - `src/cli/tui/components/views/help-view.tsx`
- Runtime control updates force fast-path off in:
  - `src/gateway/rpc/handlers/system-handlers.ts`

### 3.6 LSP diagnostics

LSP diagnostics were run on key changed runtime files and related acceptance tests, including:

- `src/gateway/rpc/handlers/conversation-handlers.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/gateway/rpc/handlers/escalation-handlers.ts`
- `src/gateway/integration/ipc-bridge.ts`
- `src/gateway/gateway-server.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/gateway/channels/channel-adapter.ts`
- `test/gateway/rpc/london-scenario-acceptance.test.ts`
- `test/gateway/integration/london-cross-channel-fanout.test.ts`

Result: no LSP errors.

## 4. Simulated runtime regression results

### 4.1 Full focused regression and build

Command executed:

```bash
npm test -- test/gateway test/scheduler-daemon test/cli/tui
npm run -s build
```

Result:

- Tests: 36 suites passed, 274 tests passed
- Build: passed

### 4.2 Scenario simulation coverage (London)

Simulation evidence includes:

- `test/gateway/rpc/london-scenario-acceptance.test.ts`
  - session-first conversation flow
  - scheduler-side goal/workitem materialization path
- `test/gateway/integration/london-cross-channel-fanout.test.ts`
  - final event fanout to enabled non-TUI channel by policy

### 4.3 Rollout/baseline script simulation

Commands executed:

```bash
node --check scripts/refine/rollback-drill.mjs
node --check scripts/refine/compare-rollout-baseline.mjs
node scripts/refine/compare-rollout-baseline.mjs --before /tmp/flow-v2-before.json --after /tmp/flow-v2-after.json
```

Observed simulation output:

- `conversationMessageSuccessRate`: 0.93 -> 0.95 (non-regression=true)
- `runSuccessRate`: 0.89 -> 0.90 (non-regression=true)

## 5. Flow risk closure mapping (old risk -> current state)

1. session-first to daemon submit chain not closed
   - Status: closed on active path
   - Evidence: session-first gateway path now IPC-forwarded; scheduler daemon supports materialize+submit path

2. queued recovery one-shot behavior
   - Status: mitigated for to-be path
   - Evidence: active to-be submission is explicit command-driven (not relying only on daemon startup recovery)

3. session-first goal direct completion with no work item
   - Status: closed for to-be materialization path
   - Evidence: materialize command supports and uses initial work item creation

4. event visibility relying on goal subscription path only
   - Status: closed on session-first visibility path
   - Evidence: gateway session mapping + session-scoped routing tests

5. TUI input mode semantic drift
   - Status: closed at UX/control plane level
   - Evidence: UI labels/help and runtime update behavior enforce session-first

## 6. Oracle blind-spot review and residual risks

Oracle review highlighted remaining high-value guards for future hardening:

- restart/fault injection around cursor persistence vs ACK semantics
- config permutation equivalence checks (non-default rollout/channel toggles)
- negative assertions (no duplicate ACK, no visibility leak, no cursor regression)

Current verdict for this regression pass:

- No failing invariant observed in static/simulated checks.
- Remaining items are hardening depth improvements, not current blockers.

## 7. Final verdict

Regression validation for to-be implementation is successful under flow-based method:

- static analysis: pass
- simulated runtime regression: pass
- scenario simulation (London + cross-channel): pass
- build and focused system regression: pass

Release readiness remains consistent with:

- `docs/refine/to-be/11-acceptance-review-matrix.md`
- `docs/refine/to-be/12-stage-summary-and-release-readiness.md`
