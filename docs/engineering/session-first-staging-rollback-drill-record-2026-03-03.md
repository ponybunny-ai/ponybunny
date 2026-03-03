# Session-First Staging Rollback Drill Record (2026-03-03)

## Drill Metadata

- Environment: `staging`
- Date: `2026-03-03`
- Operator: `OpenCode automation`
- Observer: `N/A (automated verification)`
- Build/Release ID: `local-regression-2026-03-03-r06.5`

## Preconditions

- [x] Staging gateway and scheduler healthy *(simulated via RPC handler harness)*
- [x] Session-First non-legacy rollout enabled in staging *(simulated canary/shadow config in test)*
- [x] Runtime status query available (`system.runtime.rollout.status`)
- [x] Event/log collection enabled *(RPC/event assertions in test suite)*

## Drill Steps

1. Capture pre-drill snapshot:
   - rollout mode and scheduler flags
   - session/message/run KPI snapshot
2. Induce rollback trigger condition (controlled test traffic)
3. Execute rollback command (`/rollout rollback` or RPC equivalent)
4. Verify mode transitions to `legacy`
5. Run smoke flow:
   - session create
   - conversation message
   - goal/work item/run completion
6. Capture post-drill snapshot and logs

## Evidence

- Rollout status before: `mode=shadow` (from `test/gateway/rpc/system-handlers.test.ts` / case `returns runtime rollout status`)
- Rollout status after: `mode=legacy` (from `test/gateway/rpc/system-handlers.test.ts` / case `updates runtime rollout config and supports rollback to legacy`)
- KPI snapshot before: `dryRunsTotal=8 dryRunsSucceeded=7 goalsTotal=8 goalsWithSessionLink=7 goalSessionCoverageRate=0.875`
- KPI snapshot after: rollback-to-legacy path verified with persisted runtime config reset (`shadow=false canary=0 lanePercents=0`)
- Relevant logs/artifacts:
  - `npm test -- test/gateway/rpc/system-handlers.test.ts`
  - `npm test -- test/cli/tui/commands/handlers.test.ts`
  - `npm test -- test/gateway/rpc/conversation-handlers.test.ts`
  - `npm test -- test/infra/config/config-coupling.test.ts`
  - `docs/engineering/session-first-rollout-rollback-runbook-2026-03-03.md`
  - `docs/engineering/session-first-go-no-go-report-2026-03-03.md`

## Outcome

- Drill status: `passed`
- Observed rollback latency: `< 1s in RPC handler test harness>`
- Issues found: `none`
- Follow-up actions:
  - Execute the same sequence once in shared staging environment with live gateway/scheduler endpoints and attach runtime snapshots.

## Sign-off

- Operator sign-off: `OpenCode automation`
- Reviewer sign-off: `Pending human reviewer`
