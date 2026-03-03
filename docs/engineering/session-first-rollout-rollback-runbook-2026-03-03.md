# Session-First Rollout Rollback Runbook (2026-03-03)

## Scope

This runbook defines rollback actions for Session-First rollout when anomaly thresholds are breached.

## Rollout Modes

- `legacy`: Goal-First behavior (safe baseline)
- `canary`: selective rollout using canary percentages
- `shadow`: Session-First shadow validation

## Trigger Conditions

Rollback is required when any of the following thresholds are violated under non-legacy mode:

- `conversationMessageSuccessRate < 0.80` with at least 10 conversation messages
- `runSuccessRate < 0.75` with at least 10 completed runs
- `goalSessionCoverageRate < 0.90` with at least 5 goals

These are evaluated from gateway runtime telemetry and session-goal linkage coverage.

## Immediate Rollback Procedure

1. Check current rollout status:
   - TUI: `/rollout status`
   - RPC: `system.runtime.rollout.status`
2. Trigger rollback:
   - TUI: `/rollout rollback`
   - RPC: `system.runtime.rollout.update { rollbackToLegacy: true }`
3. Verify rollback applied:
   - `mode=legacy`
   - scheduler flags: `deterministicRuntimeEnabled=false`, `planCompilerEnabled=false`, `toolRoutingMode=legacy`
   - rollout fields: `shadowModeEnabled=false`, `canaryPercent=0`, lane percents all `0`
4. Validate primary user path:
   - `/new` works
   - natural input works
   - no spike in `conversation.message` failures

## Post-Rollback Validation Checklist

- [ ] Gateway responds to `system.runtime.rollout.status`
- [ ] Rollout mode is `legacy`
- [ ] Session creation and conversation processing recover to normal levels
- [ ] Goal creation and run processing continue without regression
- [ ] No repeated rollback trigger logs after rollback

## Recovery Back to Canary

1. Fix root cause and run full test/build verification
2. Re-enable with small canary:
   - `/rollout set shadow=false canary=5 rollback=true`
3. Monitor for at least one stability window
4. Increase canary only after KPI stability is confirmed
