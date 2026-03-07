# 11. Acceptance Review Matrix

Legend:

- `pass`: acceptance item is implemented and has direct evidence.
- `partial`: implementation exists but end-to-end evidence is not yet fully closed.
- `fail`: not implemented.

## A. Role boundary acceptance

| Item | Status | Evidence |
| --- | --- | --- |
| A1 Gateway code path no longer creates Goal/WorkItem business entities | pass | `src/gateway/rpc/handlers/goal-handlers.ts`; `src/gateway/rpc/handlers/escalation-handlers.ts`; tests: `test/gateway/rpc/goal-handlers.test.ts`, `test/gateway/rpc/escalation-handlers.test.ts` |
| A2 Scheduler is the only intake decision owner | pass | `src/gateway/rpc/handlers/conversation-handlers.ts`; `src/gateway/integration/ipc-bridge.ts`; `src/scheduler-daemon/daemon.ts`; tests: `test/gateway/rpc/conversation-handlers.test.ts`, `test/gateway/integration/ipc-bridge.test.ts` |
| A3 TUI no longer exposes user-triggerable fast-path shunt entry | pass | `src/cli/tui/components/views/help-view.tsx`; `src/cli/tui/components/layout/main-layout.tsx`; tests: `test/cli/tui/commands/handlers.test.ts` |

## B. Functional consistency acceptance

| Item | Status | Evidence |
| --- | --- | --- |
| B1 Same natural-language input in session-first stably produces response-only / clarification / goal-created+execution | pass | `src/gateway/rpc/handlers/conversation-handlers.ts`; tests: `test/gateway/rpc/conversation-handlers.test.ts` |
| B2 If `goal_created`, Goal and >=1 WorkItem are materialized and submitted | pass | `src/gateway/rpc/handlers/goal-handlers.ts`; `src/scheduler-daemon/daemon.ts`; tests: `test/gateway/rpc/goal-handlers.test.ts`, `test/gateway/rpc/london-scenario-acceptance.test.ts` |

## C. Realtime communication acceptance

| Item | Status | Evidence |
| --- | --- | --- |
| C1 Gateway↔Scheduler command ACK P95 < 300ms is measurable | pass | `src/gateway/integration/ipc-bridge.ts`; `src/gateway/rpc/handlers/system-handlers.ts`; tests: `test/gateway/rpc/system-handlers.test.ts` |
| C2 Stream chunk end-to-end latency P95 < 1s is measurable | pass | `src/gateway/integration/ipc-bridge.ts`; `src/gateway/rpc/handlers/system-handlers.ts`; tests: `test/gateway/rpc/system-handlers.test.ts` |
| C3 Cursor replay after interruption can backfill key states | pass | `src/gateway/rpc/handlers/system-handlers.ts`; tests: `test/gateway/rpc/system-handlers.test.ts` |

## D. Routing and permission acceptance

| Item | Status | Evidence |
| --- | --- | --- |
| D1 Session-scoped events are visible only to corresponding session | pass | `src/gateway/events/broadcast-manager.ts`; tests: `test/gateway/events/broadcast-manager.test.ts` |
| D2 Goal-scoped events are visible only to related subscribers | pass | `src/gateway/events/broadcast-manager.ts`; tests: `test/gateway/events/broadcast-manager.test.ts` |
| D3 Broadcast-scoped events go only to enabled channels and respect policy | pass | policy and adapter dispatch implemented in `src/gateway/channels/channel-router.ts`, `src/gateway/gateway-server.ts`, `src/gateway/channels/channel-adapter-manager.ts`; tests: `test/gateway/channels/channel-router.test.ts`, `test/gateway/channels/channel-adapter-manager.test.ts`, `test/gateway/integration/london-cross-channel-fanout.test.ts` |

## E. Regression and compatibility acceptance

| Item | Status | Evidence |
| --- | --- | --- |
| E1 Legacy interfaces remain compatible in migration window with explicit deprecation timeline | pass | `docs/refine/to-be/13-compatibility-and-rollback-playbook.md`; `docs/refine/to-be/07-migration-plan.md` |
| E2 Any phase rollback recovers core path within 15 minutes | pass | `scripts/refine/rollback-drill.mjs`; `docs/refine/to-be/13-compatibility-and-rollback-playbook.md` |
| E3 Key metrics (success rate, run success) are not below pre-migration baseline | pass | `scripts/refine/compare-rollout-baseline.mjs`; `docs/refine/to-be/14-migration-baseline-comparison.md`; tests: `test/gateway/runtime/runtime-rollout-telemetry.test.ts` |

## F. London scenario acceptance

| Item | Status | Evidence |
| --- | --- | --- |
| F1 Scenario runs through session-first flow only | pass | test: `test/gateway/rpc/london-scenario-acceptance.test.ts`; handler path: `src/gateway/rpc/handlers/conversation-handlers.ts` |
| F2 Scheduler handles decision + materialization + submit | pass | test: `test/gateway/rpc/london-scenario-acceptance.test.ts`; code: `src/gateway/rpc/handlers/goal-handlers.ts`, `src/scheduler-daemon/daemon.ts` |
| F3 Execution events are realtime and visible only to current session | pass | `src/gateway/events/broadcast-manager.ts`; tests: `test/gateway/events/broadcast-manager.test.ts`, `test/gateway/rpc/london-scenario-acceptance.test.ts` |
| F4 Final result can sync to other enabled channels by policy | pass | adapter publish and policy routing implemented in `src/gateway/gateway-server.ts` and `src/gateway/channels/channel-adapter-manager.ts`; tests: `test/gateway/channels/channel-adapter-manager.test.ts`, `test/gateway/channels/channel-router.test.ts`, `test/gateway/integration/london-cross-channel-fanout.test.ts` |

## Summary

- `pass`: 17
- `partial`: 0
- `fail`: 0
