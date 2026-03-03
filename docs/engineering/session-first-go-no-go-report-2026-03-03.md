# Session-First Go/No-Go Gate Report (2026-03-03)

## Scope

This report records R-07 gate verification for Session-First final alignment.

## Gate Results

- R-07.1 Main path gate (`/new` + natural input under Session-First): PASS
- R-07.2 Idempotency gate (retry/replay should not duplicate goal/run): PASS
- R-07.3 Observability gate (trace/log/metrics chain from session to result): PASS
- R-07.4 Config gate (schema/example/pb init coupling checks): PASS
- R-07.5 Unified pre-release regression (`build`/`typecheck`/`test` + key scenarios): PASS

## Evidence

### R-07.1 Main path gate

- Test: `test/cli/tui/commands/handlers.test.ts`
  - `creates and activates a session via /new`
  - `routes natural input through session-first pipeline when fast-path is disabled`

### R-07.2 Idempotency gate

- Test: `test/gateway/rpc/internal-runtime-handlers.test.ts`
  - `executes safe idempotent replay tools when enableExecution is true`
  - verifies same `reexecutionIdempotencyKey` reuses existing execution result

### R-07.3 Observability gate

- Test: `test/gateway/rpc/conversation-handlers.test.ts`
  - verifies `conversation.new` emits session event
  - verifies `conversation.message.started/succeeded/failed` event emission
- Test: `test/gateway/rpc/workitem-handlers.test.ts`
  - verifies standardized Result DTO includes run/workItem/goal IDs (`workitem.runs`)
- Runtime KPI exposure path verified via:
  - `test/gateway/rpc/system-handlers.test.ts`
  - `test/gateway/runtime/runtime-rollout-telemetry.test.ts`

### R-07.4 Config gate

- Test: `test/infra/config/config-coupling.test.ts`
  - schema template synchronization
  - docs example alignment
  - `pb init --dry-run` structure consistency
- Test: `test/infra/config/onboarding.test.ts`
  - `pb init` generated artifacts and defaults

### R-07.5 Unified regression gate

- Command: `npm test`
- Command: `npm run build`
- Command: `npm test -- test/cli/tui/commands/handlers.test.ts`
- Command: `npm test -- test/gateway/rpc/conversation-handlers.test.ts`
- Command: `npm test -- test/gateway/rpc/internal-runtime-handlers.test.ts`

## Conclusion

R-07 gates pass in current local verification scope.
